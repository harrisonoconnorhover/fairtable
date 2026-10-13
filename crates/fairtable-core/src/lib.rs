//! Original document validation and calculated fields for Fairtable.
//!
//! The engine is shared by native persistence and the browser edition. It never
//! writes calculated values into a workspace and returns calculation failures
//! next to the affected cell.

mod engine;
mod formula;
mod validation;

pub use engine::evaluate_workspace;
pub use validation::validate_workspace;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn validate(json: &str) -> Result<(), JsValue> {
    let document = serde_json::from_str(json)
        .map_err(|error| JsValue::from_str(&format!("Invalid JSON: {error}")))?;
    validate_workspace(&document).map_err(|error| JsValue::from_str(&error))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn evaluate(json: &str) -> Result<String, JsValue> {
    let document = serde_json::from_str(json)
        .map_err(|error| JsValue::from_str(&format!("Invalid JSON: {error}")))?;
    validate_workspace(&document).map_err(|error| JsValue::from_str(&error))?;
    Ok(evaluate_workspace(&document).to_string())
}
