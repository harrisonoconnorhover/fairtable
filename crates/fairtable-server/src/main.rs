use fairtable_server::{app, store::Store, ServerConfig};
use std::{env, net::IpAddr, path::PathBuf};

fn data_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("FAIRTABLE_DATA") {
        return Ok(path.into());
    }
    if let Some(path) = env::var_os("XDG_DATA_HOME") {
        return Ok(PathBuf::from(path).join("fairtable/fairtable.sqlite3"));
    }
    #[cfg(target_os = "windows")]
    if let Some(path) = env::var_os("LOCALAPPDATA") {
        return Ok(PathBuf::from(path).join("Fairtable/fairtable.sqlite3"));
    }
    let home = env::var_os("HOME").ok_or("Set FAIRTABLE_DATA to a SQLite file path")?;
    #[cfg(target_os = "macos")]
    let suffix = "Library/Application Support/Fairtable/fairtable.sqlite3";
    #[cfg(not(target_os = "macos"))]
    let suffix = ".local/share/fairtable/fairtable.sqlite3";
    Ok(PathBuf::from(home).join(suffix))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host: IpAddr = env::var("FAIRTABLE_HOST")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()
        .map_err(|_| "FAIRTABLE_HOST must be an IP address")?;
    let port = env::var("FAIRTABLE_PORT")
        .unwrap_or_else(|_| "7777".into())
        .parse::<u16>()
        .map_err(|_| "FAIRTABLE_PORT must be a port number")?;
    if port == 0 {
        return Err("FAIRTABLE_PORT must be greater than zero".into());
    }
    let path = data_path()?;
    let mut config = ServerConfig {
        port,
        origin: env::var("FAIRTABLE_ORIGIN").ok(),
        assets: env::var_os("FAIRTABLE_ASSETS").map(PathBuf::from),
    };
    config.validate()?;
    let store = Store::open(&path)
        .map_err(|error| format!("Could not open {}: {error:?}", path.display()))?;
    let listener = tokio::net::TcpListener::bind((host, port)).await?;
    eprintln!(
        "Fairtable {} is listening on http://{}",
        env!("CARGO_PKG_VERSION"),
        listener.local_addr()?
    );
    eprintln!("Workspace database: {}", path.display());
    if !host.is_loopback() {
        eprintln!("This personal edition has no authentication. Put remote access behind an authenticated TLS reverse proxy.");
    }
    axum::serve(listener, app(store, config))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    let interrupt = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = interrupt => {}, _ = terminate => {} }
}
