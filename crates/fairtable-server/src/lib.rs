pub mod store;

use axum::{
    body::Body,
    extract::{
        rejection::{JsonRejection, PathRejection},
        DefaultBodyLimit, Path, Request, State,
    },
    http::{header, HeaderValue, Method, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use include_dir::{include_dir, Dir};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::{Component, PathBuf},
    sync::Arc,
};
use store::{Store, StoreError, MAX_DOCUMENT_BYTES};

static ASSETS: Dir<'_> = include_dir!("$OUT_DIR/ui");

#[derive(Clone)]
pub struct ServerConfig {
    pub port: u16,
    /// Exact browser origin for a TLS reverse proxy or the Vite dev server.
    pub origin: Option<String>,
    pub assets: Option<PathBuf>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            port: 7777,
            origin: None,
            assets: None,
        }
    }
}

impl ServerConfig {
    pub fn validate(&mut self) -> Result<(), String> {
        if let Some(origin) = &mut self.origin {
            *origin = origin.trim_end_matches('/').to_owned();
            let uri: Uri = origin
                .parse()
                .map_err(|_| "FAIRTABLE_ORIGIN must be an http(s) origin")?;
            if !matches!(uri.scheme_str(), Some("http" | "https"))
                || uri.authority().is_none()
                || uri.authority().is_some_and(|a| a.as_str().contains('@'))
                || uri.path_and_query().is_some_and(|p| p.as_str() != "/")
            {
                return Err("FAIRTABLE_ORIGIN must contain only scheme and host, for example https://tables.example.com".into());
            }
        }
        if let Some(assets) = &self.assets {
            if !assets.join("index.html").is_file() {
                return Err(
                    "FAIRTABLE_ASSETS must point to a built directory containing index.html".into(),
                );
            }
        }
        Ok(())
    }
}

#[derive(Clone)]
struct AppState {
    store: Arc<Store>,
    config: ServerConfig,
}

pub fn app(store: Store, config: ServerConfig) -> Router {
    let state = AppState {
        store: Arc::new(store),
        config,
    };
    let api = Router::new()
        .route("/health", get(health))
        .route("/workspace", get(workspace).put(save))
        .route("/history", get(history))
        .route("/restore/{id}", post(restore))
        .route("/export", get(export))
        .fallback(|| async { ApiError::new(StatusCode::NOT_FOUND, "Unknown API endpoint") })
        .method_not_allowed_fallback(|| async {
            ApiError::new(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed")
        });
    Router::new()
        .nest("/api", api)
        .fallback(asset)
        .layer(DefaultBodyLimit::max(MAX_DOCUMENT_BYTES + 64 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), origin_guard))
        .with_state(state)
}

struct ApiError {
    status: StatusCode,
    body: Value,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            body: json!({"error": message.into()}),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Invalid(message) => Self::new(StatusCode::UNPROCESSABLE_ENTITY, message),
            StoreError::Conflict(revision) => Self {
                status: StatusCode::CONFLICT,
                body: json!({"error": "This workspace changed in another window. Reload the saved version before saving again.", "revision": revision}),
            },
            StoreError::NotFound(message) => Self::new(StatusCode::NOT_FOUND, message),
            StoreError::Internal(message) => {
                eprintln!("Fairtable database error: {message}");
                Self::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not access the workspace database",
                )
            }
        }
    }
}

impl From<JsonRejection> for ApiError {
    fn from(error: JsonRejection) -> Self {
        Self::new(error.status(), error.body_text())
    }
}

async fn database<T: Send + 'static>(
    state: &AppState,
    operation: impl FnOnce(&Store) -> Result<T, StoreError> + Send + 'static,
) -> Result<T, ApiError> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || operation(&store))
        .await
        .map_err(|error| {
            eprintln!("Fairtable database task failed: {error}");
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not complete the database operation",
            )
        })?
        .map_err(Into::into)
}

async fn health() -> Json<Value> {
    Json(json!({"name": "Fairtable", "version": env!("CARGO_PKG_VERSION"), "storage": "sqlite"}))
}

async fn workspace(State(state): State<AppState>) -> Result<Json<store::WorkspaceState>, ApiError> {
    Ok(Json(database(&state, Store::load).await?))
}

#[derive(Deserialize)]
struct SaveRequest {
    revision: u64,
    workspace: Value,
    label: Option<String>,
}

async fn save(
    State(state): State<AppState>,
    body: Result<Json<SaveRequest>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let Json(request) = body?;
    let revision = database(&state, move |store| {
        store.save(request.revision, request.workspace, request.label)
    })
    .await?;
    Ok(Json(json!({"revision": revision})))
}

async fn history(State(state): State<AppState>) -> Result<Json<Vec<store::Snapshot>>, ApiError> {
    Ok(Json(database(&state, Store::history).await?))
}

#[derive(Deserialize)]
struct RestoreRequest {
    revision: u64,
}

async fn restore(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<RestoreRequest>, JsonRejection>,
) -> Result<Json<store::WorkspaceState>, ApiError> {
    let Path(id) = path.map_err(|error| ApiError::new(error.status(), error.body_text()))?;
    let id = id
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Invalid snapshot ID"))?;
    let Json(request) = body?;
    Ok(Json(
        database(&state, move |store| store.restore(request.revision, id)).await?,
    ))
}

async fn export(State(state): State<AppState>) -> Result<Response, ApiError> {
    let workspace = database(&state, Store::load)
        .await?
        .workspace
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "There is no saved workspace to export",
            )
        })?;
    let mut response = Json(workspace).into_response();
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"Fairtable-workspace.json\""),
    );
    Ok(response)
}

/// Host validation protects the local, unauthenticated listener from DNS
/// rebinding. An explicit origin permits a dev proxy or an authenticated proxy.
async fn origin_guard(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let authority = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .or_else(|| request.uri().authority().map(|a| a.as_str()))
        .unwrap_or("");
    let default_port = if state.config.port == 80 {
        String::new()
    } else {
        format!(":{}", state.config.port)
    };
    let local_hosts = [
        format!("127.0.0.1{default_port}"),
        format!("localhost{default_port}"),
        format!("[::1]{default_port}"),
    ];
    let configured_authority = state
        .config
        .origin
        .as_ref()
        .and_then(|origin| origin.parse::<Uri>().ok())
        .and_then(|uri| uri.authority().map(|a| a.as_str().to_owned()));
    let local_authority = local_hosts
        .iter()
        .any(|host| host.eq_ignore_ascii_case(authority));
    if !local_authority
        && !configured_authority
            .as_ref()
            .is_some_and(|host| host.eq_ignore_ascii_case(authority))
    {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            "Unrecognized host. Configure FAIRTABLE_ORIGIN for a reverse proxy.",
        )
        .into_response();
    }
    let is_write = !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    if is_write {
        if request
            .headers()
            .get("sec-fetch-site")
            .is_some_and(|v| v == "cross-site")
        {
            return ApiError::new(StatusCode::FORBIDDEN, "Cross-site writes are not allowed")
                .into_response();
        }
        if let Some(origin) = request.headers().get(header::ORIGIN) {
            let origin = origin.to_str().unwrap_or("");
            let same_origin = local_authority && origin == format!("http://{authority}");
            let configured_origin = state.config.origin.as_deref() == Some(origin);
            if !same_origin && !configured_origin {
                return ApiError::new(StatusCode::FORBIDDEN, "Cross-origin writes are not allowed")
                    .into_response();
            }
        }
    }
    let is_api = request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    if is_api {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

async fn asset(State(state): State<AppState>, request: Request) -> Response {
    if request.uri().path() == "/api" || request.uri().path().starts_with("/api/") {
        return ApiError::new(StatusCode::NOT_FOUND, "Unknown API endpoint").into_response();
    }
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return ApiError::new(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed").into_response();
    }
    let path = request.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if std::path::Path::new(path)
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return ApiError::new(StatusCode::BAD_REQUEST, "Invalid asset path").into_response();
    }
    let has_extension = std::path::Path::new(path).extension().is_some();
    let (bytes, served_path) = if let Some(directory) = &state.config.assets {
        match tokio::fs::read(directory.join(path)).await {
            Ok(bytes) => (bytes, path),
            Err(_) if !has_extension => match tokio::fs::read(directory.join("index.html")).await {
                Ok(bytes) => (bytes, "index.html"),
                Err(_) => {
                    return ApiError::new(StatusCode::NOT_FOUND, "Web interface was not found")
                        .into_response()
                }
            },
            Err(_) => {
                return ApiError::new(StatusCode::NOT_FOUND, "Asset not found").into_response()
            }
        }
    } else {
        match ASSETS.get_file(path).or_else(|| {
            if has_extension {
                None
            } else {
                ASSETS.get_file("index.html")
            }
        }) {
            Some(file) => (
                file.contents().to_vec(),
                file.path().to_str().unwrap_or("index.html"),
            ),
            None => return ApiError::new(StatusCode::NOT_FOUND, "Asset not found").into_response(),
        }
    };
    let mime = mime_guess::from_path(served_path).first_or_octet_stream();
    let content_length = bytes.len();
    let mut response = Response::new(if request.method() == Method::HEAD {
        Body::empty()
    } else {
        Body::from(bytes)
    });
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap(),
    );
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, HeaderValue::from(content_length));
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use tower::ServiceExt;

    async fn call(
        app: Router,
        method: Method,
        path: &str,
        body: Value,
        origin: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, "127.0.0.1:7777")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        let response = app
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn api_round_trip_history_conflict_restore_and_export() {
        let directory = tempfile::tempdir().unwrap();
        let app = app(
            Store::open(&directory.path().join("workspace.db")).unwrap(),
            ServerConfig::default(),
        );
        let (status, fresh) = call(
            app.clone(),
            Method::GET,
            "/api/workspace",
            Value::Null,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(fresh, json!({"revision": 0, "workspace": null}));
        let first = json!({"version": 1, "name": "First", "bases": []});
        let second = json!({"version": 1, "name": "Second", "bases": []});
        let (status, saved) = call(
            app.clone(),
            Method::PUT,
            "/api/workspace",
            json!({"revision": 0, "workspace": first, "label": "First"}),
            Some("http://127.0.0.1:7777"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(saved["revision"], 1);
        let (status, conflict) = call(
            app.clone(),
            Method::PUT,
            "/api/workspace",
            json!({"revision": 0, "workspace": second}),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(conflict["revision"], 1);
        assert_eq!(
            call(
                app.clone(),
                Method::PUT,
                "/api/workspace",
                json!({"revision": 1, "workspace": second}),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
        let (_, history) = call(app.clone(), Method::GET, "/api/history", Value::Null, None).await;
        assert_eq!(history.as_array().unwrap().len(), 1);
        assert_eq!(history[0]["label"], "First");
        let (status, restored) = call(
            app.clone(),
            Method::POST,
            &format!("/api/restore/{}", history[0]["id"]),
            json!({"revision": 2}),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(restored, json!({"revision": 3, "workspace": first}));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/export")
                    .header(header::HOST, "127.0.0.1:7777")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .contains("attachment"));
        assert_eq!(
            serde_json::from_slice::<Value>(
                &to_bytes(response.into_body(), usize::MAX).await.unwrap()
            )
            .unwrap(),
            first
        );
    }

    #[tokio::test]
    async fn unsafe_origins_and_invalid_documents_leave_store_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let app = app(
            Store::open(&directory.path().join("workspace.db")).unwrap(),
            ServerConfig::default(),
        );
        let body = json!({"revision": 0, "workspace": {"version": 1, "name": "Good", "bases": []}});
        assert_eq!(
            call(
                app.clone(),
                Method::PUT,
                "/api/workspace",
                body,
                Some("https://evil.example")
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(
                app.clone(),
                Method::PUT,
                "/api/workspace",
                json!({"revision": 0, "workspace": {"bad": true}}),
                None
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            call(
                app.clone(),
                Method::PUT,
                "/api/workspace",
                json!({"workspace": {}}),
                None
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            call(
                app.clone(),
                Method::GET,
                "/api/workspace",
                Value::Null,
                None
            )
            .await
            .1["revision"],
            0
        );
        assert_eq!(
            call(
                app.clone(),
                Method::POST,
                "/api/restore/not-a-number",
                json!({"revision": 0}),
                None
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            call(app, Method::GET, "/api/not-real", Value::Null, None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn explicit_dev_origin_and_embedded_spa_work() {
        let directory = tempfile::tempdir().unwrap();
        let config = ServerConfig {
            origin: Some("http://127.0.0.1:5177".into()),
            ..Default::default()
        };
        let app = app(
            Store::open(&directory.path().join("workspace.db")).unwrap(),
            config,
        );
        assert_eq!(
            call(
                app.clone(),
                Method::PUT,
                "/api/workspace",
                json!({"revision": 0, "workspace": {"version": 1, "name": "Dev", "bases": []}}),
                Some("http://127.0.0.1:5177")
            )
            .await
            .0,
            StatusCode::OK
        );
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/base/a")
                    .header(header::HOST, "localhost:7777")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "text/html");
    }

    #[tokio::test]
    async fn rejects_rebinding_and_requires_configured_proxy_scheme() {
        let directory = tempfile::tempdir().unwrap();
        let config = ServerConfig {
            origin: Some("https://tables.example.com".into()),
            ..Default::default()
        };
        let app = app(
            Store::open(&directory.path().join("workspace.db")).unwrap(),
            config,
        );
        for (host, origin) in [
            ("evil.example:7777", "http://evil.example:7777"),
            ("tables.example.com", "http://tables.example.com"),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::PUT)
                        .uri("/api/workspace")
                        .header(header::HOST, host)
                        .header(header::ORIGIN, origin)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(
                            r#"{"revision":0,"workspace":{"version":1,"name":"Proxy","bases":[]}}"#,
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri("/api/workspace")
                    .header(header::HOST, "tables.example.com")
                    .header(header::ORIGIN, "https://tables.example.com")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"revision":0,"workspace":{"version":1,"name":"Proxy","bases":[]}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn malformed_and_oversized_requests_have_json_errors() {
        let directory = tempfile::tempdir().unwrap();
        let app = app(
            Store::open(&directory.path().join("workspace.db")).unwrap(),
            ServerConfig::default(),
        );
        for (body, status) in [
            ("{".to_string(), StatusCode::BAD_REQUEST),
            (
                "x".repeat(MAX_DOCUMENT_BYTES + 64 * 1024 + 1),
                StatusCode::PAYLOAD_TOO_LARGE,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::PUT)
                        .uri("/api/workspace")
                        .header(header::HOST, "127.0.0.1:7777")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            let error: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                    .unwrap();
            assert!(error["error"].is_string());
        }
        assert_eq!(
            call(app, Method::GET, "/api/workspace", Value::Null, None)
                .await
                .1["revision"],
            0
        );
    }
}
