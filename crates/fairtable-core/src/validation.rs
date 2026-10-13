use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

const FIELD_TYPES: &[&str] = &[
    "text",
    "longText",
    "number",
    "currency",
    "percent",
    "checkbox",
    "date",
    "email",
    "url",
    "singleSelect",
    "multiSelect",
    "link",
    "formula",
    "lookup",
    "rollup",
];

pub(crate) fn calculated(kind: &str) -> bool {
    matches!(kind, "formula" | "lookup" | "rollup")
}

fn object<'a>(value: &'a Value, at: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{at} must be an object"))
}

fn array<'a>(value: &'a Value, key: &str, at: &str) -> Result<&'a Vec<Value>, String> {
    value[key]
        .as_array()
        .ok_or_else(|| format!("{at}.{key} must be an array"))
}

fn string<'a>(
    value: &'a Value,
    key: &str,
    at: &str,
    max: usize,
    empty: bool,
) -> Result<&'a str, String> {
    let text = value[key]
        .as_str()
        .ok_or_else(|| format!("{at}.{key} must be a string"))?;
    if text.len() > max || (!empty && text.trim().is_empty()) {
        return Err(format!(
            "{at}.{key} must contain {} to {max} bytes",
            usize::from(!empty)
        ));
    }
    Ok(text)
}

fn optional_string(value: &Value, key: &str, at: &str, max: usize) -> Result<(), String> {
    if value.get(key).is_some() {
        string(value, key, at, max, true)?;
    }
    Ok(())
}

fn unique_id<'a>(value: &'a Value, at: &str, ids: &mut HashSet<String>) -> Result<&'a str, String> {
    let id = string(value, "id", at, 128, false)?;
    if !ids.insert(id.to_owned()) {
        return Err(format!("Duplicate ID '{id}' at {at}"));
    }
    Ok(id)
}

fn one_of(value: &Value, key: &str, at: &str, choices: &[&str]) -> Result<(), String> {
    let choice = string(value, key, at, 128, false)?;
    if !choices.contains(&choice) {
        return Err(format!("Unsupported {at}.{key}: {choice}"));
    }
    Ok(())
}

pub(crate) fn date_parts(text: &str) -> Option<(i32, u32, u32)> {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(i, ch)| i == 4 || i == 7 || ch.is_ascii_digit())
    {
        return None;
    }
    let year: i32 = text.get(..4)?.parse().ok()?;
    let month: u32 = text.get(5..7)?.parse().ok()?;
    let day: u32 = text.get(8..)?.parse().ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return None,
    };
    (year > 0 && day > 0 && day <= days).then_some((year, month, day))
}

/// Validate the complete persisted document, including references and cell types.
/// Formula expressions are deliberately left to the calculation engine.
pub fn validate_workspace(workspace: &Value) -> Result<(), String> {
    object(workspace, "workspace")?;
    if workspace.to_string().len() > 32 * 1024 * 1024 {
        return Err("Workspace exceeds the 32 MiB document limit".into());
    }
    if workspace["version"].as_u64() != Some(1) {
        return Err("workspace.version must be 1".into());
    }
    string(workspace, "name", "workspace", 256, false)?;
    let bases = array(workspace, "bases", "workspace")?;
    if bases.len() > 50 {
        return Err("Workspace exceeds the 50 base limit".into());
    }
    let mut ids = HashSet::new();
    let mut tables = HashMap::new();
    let mut record_count = 0;
    // Collect identity and shape before resolving links, which may point forward.
    for base in bases {
        object(base, "base")?;
        let base_id = unique_id(base, "base", &mut ids)?;
        let at = format!("base '{base_id}'");
        string(base, "name", &at, 256, false)?;
        string(base, "color", &at, 64, true)?;
        string(base, "description", &at, 65536, true)?;
        for table in array(base, "tables", &at)? {
            object(table, "table")?;
            let table_id = unique_id(table, "table", &mut ids)?;
            let at = format!("table '{table_id}'");
            string(table, "name", &at, 256, false)?;
            tables.insert(table_id, table);
            if tables.len() > 100 {
                return Err("Workspace exceeds the 100 table limit".into());
            }
            let fields = array(table, "fields", &at)?;
            if fields.len() > 200 {
                return Err(format!("{at} exceeds the 200 field limit"));
            }
            let mut field_names = HashSet::new();
            for field in fields {
                object(field, "field")?;
                let field_id = unique_id(field, "field", &mut ids)?;
                let at = format!("field '{field_id}'");
                let name = string(field, "name", &at, 256, false)?;
                if !field_names.insert(name.to_lowercase()) {
                    return Err(format!(
                        "Duplicate field name '{name}' in table '{table_id}'"
                    ));
                }
                one_of(field, "type", &at, FIELD_TYPES)?;
                let width = field["width"]
                    .as_f64()
                    .ok_or_else(|| format!("{at}.width must be a number"))?;
                if !(40.0..=2000.0).contains(&width) {
                    return Err(format!("{at}.width must be between 40 and 2000"));
                }
                optional_string(field, "description", &at, 65536)?;
                optional_string(field, "formula", &at, 8192)?;
                for key in [
                    "linkedTableId",
                    "inverseFieldId",
                    "linkFieldId",
                    "targetFieldId",
                ] {
                    optional_string(field, key, &at, 128)?;
                }
                if field.get("precision").is_some()
                    && field["precision"].as_u64().is_none_or(|n| n > 10)
                {
                    return Err(format!("{at}.precision must be an integer from 0 to 10"));
                }
                if field.get("aggregation").is_some() {
                    one_of(
                        field,
                        "aggregation",
                        &at,
                        &[
                            "SUM",
                            "AVERAGE",
                            "MIN",
                            "MAX",
                            "COUNT",
                            "COUNTA",
                            "ARRAYJOIN",
                        ],
                    )?;
                }
                if field.get("options").is_some() {
                    let options = array(field, "options", &at)?;
                    if options.len() > 500 {
                        return Err(format!("{at} exceeds the 500 option limit"));
                    }
                    let mut names = HashSet::new();
                    for option in options {
                        object(option, "option")?;
                        unique_id(option, "option", &mut ids)?;
                        let name = string(option, "name", "option", 256, false)?;
                        string(option, "color", "option", 64, true)?;
                        if !names.insert(name) {
                            return Err(format!("Duplicate option '{name}' in {at}"));
                        }
                    }
                }
            }
            let records = array(table, "records", &at)?;
            record_count += records.len();
            if record_count > 25_000 {
                return Err("Workspace exceeds the 25,000 record limit".into());
            }
            for record in records {
                object(record, "record")?;
                unique_id(record, "record", &mut ids)?;
                string(record, "createdAt", "record", 64, false)?;
                string(record, "updatedAt", "record", 64, false)?;
                object(&record["cells"], "record.cells")?;
            }
            for view in array(table, "views", &at)? {
                object(view, "view")?;
                unique_id(view, "view", &mut ids)?;
                validate_view(view, fields, &mut ids)?;
            }
        }
    }
    // Build membership sets once, not once per cell in a linked table.
    let record_ids: HashMap<&str, HashSet<&str>> = tables
        .iter()
        .map(|(&id, table)| {
            (
                id,
                table["records"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|r| r["id"].as_str())
                    .collect(),
            )
        })
        .collect();
    let option_names: HashMap<&str, HashSet<&str>> = tables
        .values()
        .flat_map(|table| {
            table["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|field| {
                    field["id"].as_str().map(|id| {
                        (
                            id,
                            field["options"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|option| option["name"].as_str())
                                .collect(),
                        )
                    })
                })
        })
        .collect();
    let mut reciprocal_edges = HashSet::new();
    for (&table_id, &table) in &tables {
        let fields = array(table, "fields", "table")?;
        let field_by_id: HashMap<&str, &Value> = fields
            .iter()
            .filter_map(|f| f["id"].as_str().map(|id| (id, f)))
            .collect();
        for field in fields {
            let at = format!("field '{}'", field["name"].as_str().unwrap_or(""));
            if field.get("inverseFieldId").is_some() && field["type"] != "link" {
                return Err(format!("{at}.inverseFieldId is only valid for link fields"));
            }
            match field["type"].as_str().unwrap_or("") {
                "link" => {
                    let target = string(field, "linkedTableId", &at, 128, false)?;
                    let linked = tables
                        .get(target)
                        .ok_or_else(|| format!("{at} links to unknown table '{target}'"))?;
                    if field.get("inverseFieldId").is_some() {
                        let inverse_id = string(field, "inverseFieldId", &at, 128, false)?;
                        let inverse = array(linked, "fields", "linked table")?
                            .iter()
                            .find(|candidate| candidate["id"] == inverse_id)
                            .ok_or_else(|| {
                                format!("{at} references unknown inverse field '{inverse_id}'")
                            })?;
                        if inverse["type"] != "link"
                            || inverse["linkedTableId"] != table_id
                            || inverse["inverseFieldId"] != field["id"]
                        {
                            return Err(format!("{at} must declare a mutual inverse link pointing back to its table"));
                        }
                    }
                }
                "lookup" | "rollup" => {
                    let link_id = string(field, "linkFieldId", &at, 128, false)?;
                    let link = field_by_id
                        .get(link_id)
                        .ok_or_else(|| format!("{at} references unknown link field '{link_id}'"))?;
                    if link["type"] != "link" {
                        return Err(format!("{at}.linkFieldId must refer to a link field"));
                    }
                    let linked = link["linkedTableId"]
                        .as_str()
                        .and_then(|id| tables.get(id))
                        .ok_or_else(|| format!("{at} has an invalid linked table"))?;
                    let target = string(field, "targetFieldId", &at, 128, false)?;
                    if !array(linked, "fields", "linked table")?
                        .iter()
                        .any(|f| f["id"] == target)
                    {
                        return Err(format!("{at} references unknown target field '{target}'"));
                    }
                    if field["type"] == "rollup" {
                        one_of(
                            field,
                            "aggregation",
                            &at,
                            &[
                                "SUM",
                                "AVERAGE",
                                "MIN",
                                "MAX",
                                "COUNT",
                                "COUNTA",
                                "ARRAYJOIN",
                            ],
                        )?;
                    }
                }
                _ => {}
            }
        }
        for record in array(table, "records", "table")? {
            for (field_id, cell) in object(&record["cells"], "record.cells")? {
                let field = field_by_id.get(field_id.as_str()).ok_or_else(|| {
                    format!(
                        "Record '{}' contains unknown field '{field_id}' in table '{table_id}'",
                        record["id"]
                    )
                })?;
                let allowed = if field["type"] == "link" {
                    field["linkedTableId"]
                        .as_str()
                        .and_then(|id| record_ids.get(id))
                } else {
                    option_names.get(field_id.as_str())
                };
                validate_cell(cell, field, allowed).map_err(|error| {
                    format!(
                        "Record '{}', field '{}': {error}",
                        record["id"].as_str().unwrap_or(""),
                        field["name"].as_str().unwrap_or("")
                    )
                })?;
                if let Some(inverse_id) = field["inverseFieldId"].as_str() {
                    let source_id = record["id"].as_str().unwrap_or("");
                    for target_id in cell
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                    {
                        reciprocal_edges.insert((
                            source_id,
                            field_id.as_str(),
                            target_id,
                            inverse_id,
                        ));
                    }
                }
            }
        }
    }
    for &(source_id, field_id, target_id, inverse_id) in &reciprocal_edges {
        if !reciprocal_edges.contains(&(target_id, inverse_id, source_id, field_id)) {
            return Err(format!("Record '{source_id}', field '{field_id}': reciprocal link is missing from record '{target_id}'"));
        }
    }
    Ok(())
}

fn validate_view(view: &Value, fields: &[Value], ids: &mut HashSet<String>) -> Result<(), String> {
    string(view, "name", "view", 256, false)?;
    one_of(
        view,
        "type",
        "view",
        &["grid", "kanban", "gallery", "calendar", "form"],
    )?;
    one_of(view, "filterMode", "view", &["and", "or"])?;
    one_of(
        view,
        "rowHeight",
        "view",
        &["compact", "comfortable", "tall"],
    )?;
    let field_ids: HashSet<_> = fields
        .iter()
        .filter_map(|field| field["id"].as_str())
        .collect();
    let check_ref = |reference: &Value| -> Result<(), String> {
        if !reference.as_str().is_some_and(|id| field_ids.contains(id)) {
            return Err(format!(
                "View '{}' references an unknown field",
                view["name"].as_str().unwrap_or("")
            ));
        }
        Ok(())
    };
    for key in ["groupFieldId", "dateFieldId"] {
        if let Some(reference) = view.get(key) {
            check_ref(reference)?;
        }
    }
    for key in ["hiddenFields", "requiredFields"] {
        if key == "hiddenFields" || view.get(key).is_some() {
            let mut seen = HashSet::new();
            for reference in array(view, key, "view")? {
                check_ref(reference)?;
                if !seen.insert(reference.as_str()) {
                    return Err(format!("view.{key} contains duplicate field references"));
                }
            }
        }
    }
    for filter in array(view, "filters", "view")? {
        object(filter, "filter")?;
        unique_id(filter, "filter", ids)?;
        check_ref(&filter["fieldId"])?;
        one_of(
            filter,
            "operator",
            "filter",
            &[
                "contains",
                "notContains",
                "is",
                "isNot",
                "empty",
                "notEmpty",
                "gt",
                "lt",
                "gte",
                "lte",
            ],
        )?;
        string(filter, "value", "filter", 65536, true)?;
    }
    for sort in array(view, "sorts", "view")? {
        object(sort, "sort")?;
        check_ref(&sort["fieldId"])?;
        one_of(sort, "direction", "sort", &["asc", "desc"])?;
    }
    optional_string(view, "formDescription", "view", 65536)?;
    Ok(())
}

fn validate_cell(
    cell: &Value,
    field: &Value,
    allowed: Option<&HashSet<&str>>,
) -> Result<(), String> {
    if cell.is_null() {
        return Ok(());
    }
    let kind = field["type"].as_str().unwrap_or("");
    if calculated(kind) {
        return Err("Calculated values must not be stored in cells".into());
    }
    match kind {
        "number" | "currency" | "percent" => {
            if !cell.as_f64().is_some_and(f64::is_finite) {
                return Err("Expected a finite number or null".into());
            }
        }
        "checkbox" => {
            if !cell.is_boolean() {
                return Err("Expected true, false, or null".into());
            }
        }
        "link" | "multiSelect" => {
            let values = cell
                .as_array()
                .ok_or("Expected an array of strings or null")?;
            let mut seen = HashSet::new();
            for value in values {
                let text = value.as_str().ok_or("Array entries must be strings")?;
                if !seen.insert(text) {
                    return Err("Duplicate array entries are not allowed".into());
                }
                if !allowed.is_some_and(|allowed| allowed.contains(text)) {
                    return Err(if kind == "link" {
                        format!("Dangling link to record '{text}'")
                    } else {
                        format!("Unknown select option '{text}'")
                    });
                }
            }
        }
        _ => {
            let text = cell.as_str().ok_or("Expected a string or null")?;
            if text.len() > 1_048_576 {
                return Err("Cell exceeds the 1 MiB text limit".into());
            }
            if kind == "date" && date_parts(text).is_none() {
                return Err("Date must be a valid YYYY-MM-DD value or null".into());
            }
            if kind == "singleSelect" && !allowed.is_some_and(|allowed| allowed.contains(text)) {
                return Err(format!("Unknown select option '{text}'"));
            }
        }
    }
    Ok(())
}
