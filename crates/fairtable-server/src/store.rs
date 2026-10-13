use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use std::{path::Path, sync::Mutex, time::Duration};

pub const MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug)]
pub enum StoreError {
    Invalid(String),
    Conflict(u64),
    NotFound(String),
    Internal(String),
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Internal(error.to_string())
    }
}

#[derive(Debug, Serialize)]
pub struct WorkspaceState {
    pub revision: u64,
    pub workspace: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: i64,
    pub created_at: String,
    pub label: String,
}

/// A connection is shared only through this mutex. Each mutation also uses an
/// IMMEDIATE transaction, so revision checks remain atomic across processes.
pub struct Store {
    connection: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|e| StoreError::Internal(e.to_string()))?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                revision INTEGER NOT NULL CHECK (revision >= 0),
                document TEXT,
                label TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT OR IGNORE INTO workspace VALUES
                (1, 0, NULL, 'Initial workspace', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document TEXT NOT NULL,
                label TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, StoreError> {
        self.connection
            .lock()
            .map_err(|_| StoreError::Internal("Database lock was poisoned".into()))
    }

    pub fn load(&self) -> Result<WorkspaceState, StoreError> {
        let connection = self.connection()?;
        let (revision, document): (u64, Option<String>) = connection.query_row(
            "SELECT revision, document FROM workspace WHERE singleton = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let workspace = document
            .map(|value| {
                serde_json::from_str(&value).map_err(|e| StoreError::Internal(e.to_string()))
            })
            .transpose()?;
        Ok(WorkspaceState {
            revision,
            workspace,
        })
    }

    pub fn save(
        &self,
        revision: u64,
        workspace: Value,
        label: Option<String>,
    ) -> Result<u64, StoreError> {
        let document = validate_and_serialize(&workspace)?;
        let label = label.unwrap_or_else(|| "Saved workspace".into());
        if label.len() > 200 {
            return Err(StoreError::Invalid(
                "History labels must be at most 200 bytes".into(),
            ));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let next_revision = check_revision(&transaction, revision)?;
        archive_current(&transaction)?;
        transaction.execute(
            "UPDATE workspace SET revision = ?1, document = ?2, label = ?3,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1",
            params![next_revision, document, label],
        )?;
        transaction.commit()?;
        Ok(next_revision)
    }

    pub fn history(&self) -> Result<Vec<Snapshot>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT id, created_at, label FROM snapshots ORDER BY id DESC LIMIT 30")?;
        let rows = statement.query_map([], |row| {
            Ok(Snapshot {
                id: row.get(0)?,
                created_at: row.get(1)?,
                label: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn restore(&self, revision: u64, id: i64) -> Result<WorkspaceState, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let next_revision = check_revision(&transaction, revision)?;
        let document: String = transaction
            .query_row(
                "SELECT document FROM snapshots WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::NotFound("That history snapshot no longer exists".into()))?;
        let workspace: Value =
            serde_json::from_str(&document).map_err(|e| StoreError::Internal(e.to_string()))?;
        // Revalidate persisted snapshots before they can replace the current document.
        validate_and_serialize(&workspace)?;
        archive_current(&transaction)?;
        transaction.execute(
            "UPDATE workspace SET revision = ?1, document = ?2, label = ?3,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1",
            params![next_revision, document, format!("Restored snapshot {id}")],
        )?;
        transaction.commit()?;
        Ok(WorkspaceState {
            revision: next_revision,
            workspace: Some(workspace),
        })
    }
}

fn validate_and_serialize(workspace: &Value) -> Result<String, StoreError> {
    fairtable_core::validate_workspace(workspace).map_err(StoreError::Invalid)?;
    let document =
        serde_json::to_string(workspace).map_err(|e| StoreError::Invalid(e.to_string()))?;
    if document.len() > MAX_DOCUMENT_BYTES {
        return Err(StoreError::Invalid(
            "Workspace exceeds the 32 MiB limit".into(),
        ));
    }
    Ok(document)
}

fn check_revision(transaction: &Transaction<'_>, expected: u64) -> Result<u64, StoreError> {
    let revision: u64 = transaction.query_row(
        "SELECT revision FROM workspace WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    if revision != expected {
        return Err(StoreError::Conflict(revision));
    }
    revision
        .checked_add(1)
        .filter(|r| *r <= i64::MAX as u64)
        .ok_or_else(|| StoreError::Internal("Workspace revision limit reached".into()))
}

fn archive_current(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT INTO snapshots(document, label, created_at)
         SELECT document, label, updated_at FROM workspace
         WHERE singleton = 1 AND document IS NOT NULL",
        [],
    )?;
    transaction.execute(
        "DELETE FROM snapshots WHERE id NOT IN
         (SELECT id FROM snapshots ORDER BY id DESC LIMIT 30)",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};

    fn workspace(name: &str) -> Value {
        json!({"version": 1, "name": name, "bases": []})
    }

    #[test]
    fn saves_reopen_and_refuse_invalid_or_stale_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        let store = Store::open(&path).unwrap();
        assert!(store.load().unwrap().workspace.is_none());
        assert_eq!(
            store
                .save(0, workspace("First"), Some("First save".into()))
                .unwrap(),
            1
        );
        drop(store);
        let store = Store::open(&path).unwrap();
        assert_eq!(store.load().unwrap().workspace, Some(workspace("First")));
        assert!(matches!(
            store.save(0, workspace("Stale"), None),
            Err(StoreError::Conflict(1))
        ));
        assert!(matches!(
            store.save(1, json!({"bad": true}), None),
            Err(StoreError::Invalid(_))
        ));
        assert_eq!(store.load().unwrap().revision, 1);
        assert_eq!(store.load().unwrap().workspace, Some(workspace("First")));
        assert!(store.history().unwrap().is_empty());
    }

    #[test]
    fn independent_connections_race_with_exactly_one_winner() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        let stores = [Store::open(&path).unwrap(), Store::open(&path).unwrap()];
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = stores
            .into_iter()
            .enumerate()
            .map(|(i, store)| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store.save(0, workspace(&format!("Writer {i}")), None)
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|r| matches!(r, Ok(1))).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|r| matches!(r, Err(StoreError::Conflict(1))))
                .count(),
            1
        );
        let store = Store::open(&path).unwrap();
        assert_eq!(store.load().unwrap().revision, 1);
    }

    #[test]
    fn restore_preserves_current_state_and_keeps_thirty_prior_snapshots() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        let store = Store::open(&path).unwrap();
        for revision in 0..35 {
            store
                .save(
                    revision,
                    workspace(&format!("Save {revision}")),
                    Some(format!("Save {revision}")),
                )
                .unwrap();
        }
        let history = store.history().unwrap();
        assert_eq!(history.len(), 30);
        assert_eq!(history.first().unwrap().label, "Save 33");
        assert_eq!(history.last().unwrap().label, "Save 4");
        let id = history.last().unwrap().id;
        assert!(matches!(
            store.restore(34, id),
            Err(StoreError::Conflict(35))
        ));
        let restored = store.restore(35, id).unwrap();
        assert_eq!(restored.revision, 36);
        assert_eq!(restored.workspace, Some(workspace("Save 4")));
        let previous = store.history().unwrap().first().unwrap().id;
        assert_eq!(
            store.restore(36, previous).unwrap().workspace,
            Some(workspace("Save 34"))
        );
        drop(store);
        assert_eq!(Store::open(&path).unwrap().history().unwrap().len(), 30);
    }
}
