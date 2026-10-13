use crate::{formula, validate_workspace, validation::calculated};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

type CellKey = (usize, usize, usize);
type CellResult = Result<Value, String>;

struct Table<'a> {
    id: &'a str,
    fields: Vec<&'a Value>,
    records: Vec<&'a Value>,
    field_ids: HashMap<&'a str, usize>,
    field_names: HashMap<String, usize>,
    record_ids: HashMap<&'a str, usize>,
    formulas: HashMap<usize, Result<Rc<formula::Expr>, String>>,
}

struct Engine<'a> {
    tables: Vec<Table<'a>>,
    table_ids: HashMap<&'a str, usize>,
    cache: HashMap<CellKey, CellResult>,
    active: HashSet<CellKey>,
}

/// Evaluate a snapshot without mutating it. Invalid input returns an `error`
/// alongside empty values/errors; valid documents report errors per cell.
pub fn evaluate_workspace(workspace: &Value) -> Value {
    if let Err(error) = validate_workspace(workspace) {
        return json!({"values": {}, "errors": {}, "error": error});
    }
    let mut engine = Engine::new(workspace);
    let mut values = Map::new();
    let mut errors = Map::new();
    for table_index in 0..engine.tables.len() {
        let mut table_values = Map::new();
        let mut table_errors = Map::new();
        for record_index in 0..engine.tables[table_index].records.len() {
            let mut record_values = Map::new();
            let mut record_errors = Map::new();
            for field_index in 0..engine.tables[table_index].fields.len() {
                let field_id = engine.tables[table_index].fields[field_index]["id"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned();
                match engine.cell((table_index, record_index, field_index), 0) {
                    Ok(value) => {
                        record_values.insert(field_id, value);
                    }
                    Err(error) => {
                        record_values.insert(field_id.clone(), Value::Null);
                        record_errors.insert(field_id, Value::String(error));
                    }
                }
            }
            let record_id = engine.tables[table_index].records[record_index]["id"]
                .as_str()
                .unwrap_or("")
                .to_owned();
            table_values.insert(record_id.clone(), Value::Object(record_values));
            if !record_errors.is_empty() {
                table_errors.insert(record_id, Value::Object(record_errors));
            }
        }
        let table_id = engine.tables[table_index].id.to_owned();
        values.insert(table_id.clone(), Value::Object(table_values));
        if !table_errors.is_empty() {
            errors.insert(table_id, Value::Object(table_errors));
        }
    }
    json!({"values": values, "errors": errors})
}

impl<'a> Engine<'a> {
    fn new(workspace: &'a Value) -> Self {
        let mut tables = Vec::new();
        let mut table_ids = HashMap::new();
        for base in workspace["bases"].as_array().into_iter().flatten() {
            for table in base["tables"].as_array().into_iter().flatten() {
                let id = table["id"].as_str().unwrap_or("");
                table_ids.insert(id, tables.len());
                let fields: Vec<_> = table["fields"].as_array().into_iter().flatten().collect();
                let records: Vec<_> = table["records"].as_array().into_iter().flatten().collect();
                let field_ids = fields
                    .iter()
                    .enumerate()
                    .filter_map(|(index, field)| field["id"].as_str().map(|id| (id, index)))
                    .collect();
                let field_names = fields
                    .iter()
                    .enumerate()
                    .filter_map(|(index, field)| {
                        field["name"]
                            .as_str()
                            .map(|name| (name.to_lowercase(), index))
                    })
                    .collect();
                let record_ids = records
                    .iter()
                    .enumerate()
                    .filter_map(|(index, record)| record["id"].as_str().map(|id| (id, index)))
                    .collect();
                let formulas = fields
                    .iter()
                    .enumerate()
                    .filter(|(_, field)| field["type"] == "formula")
                    .map(|(index, field)| {
                        (
                            index,
                            formula::parse(field["formula"].as_str().unwrap_or("")).map(Rc::new),
                        )
                    })
                    .collect();
                tables.push(Table {
                    id,
                    fields,
                    records,
                    field_ids,
                    field_names,
                    record_ids,
                    formulas,
                });
            }
        }
        Self {
            tables,
            table_ids,
            cache: HashMap::new(),
            active: HashSet::new(),
        }
    }

    fn cell(&mut self, key: CellKey, depth: usize) -> CellResult {
        if let Some(value) = self.cache.get(&key) {
            return value.clone();
        }
        if self.active.contains(&key) {
            return Err("Circular field dependency".into());
        }
        if depth > 128 {
            return Err("Field dependency chain exceeds 128 levels".into());
        }
        self.active.insert(key);
        let result = self.calculate(key, depth);
        self.active.remove(&key);
        // A depth error depends on the caller's starting point. Do not let a
        // long chain poison shorter chains evaluated independently afterward.
        if result
            .as_ref()
            .err()
            .is_none_or(|error| !error.contains("Field dependency chain exceeds"))
        {
            self.cache.insert(key, result.clone());
        }
        result
    }

    fn calculate(
        &mut self,
        (table_index, record_index, field_index): CellKey,
        depth: usize,
    ) -> CellResult {
        let table = &self.tables[table_index];
        let field = table.fields[field_index];
        let field_id = field["id"].as_str().unwrap_or("");
        let kind = field["type"].as_str().unwrap_or("");
        if !calculated(kind) {
            return Ok(table.records[record_index]["cells"]
                .get(field_id)
                .cloned()
                .unwrap_or(Value::Null));
        }
        if kind == "formula" {
            let expression = table
                .formulas
                .get(&field_index)
                .ok_or("Missing formula")?
                .clone()?;
            return formula::evaluate(&expression, &mut |name| {
                let index = self.tables[table_index]
                    .field_names
                    .get(&name.to_lowercase())
                    .copied()
                    .ok_or_else(|| format!("Unknown field '{{{name}}}'"))?;
                self.cell((table_index, record_index, index), depth + 1)
                    .map_err(|error| format!("{{{name}}}: {error}"))
            });
        }
        let link_index = table
            .field_ids
            .get(field["linkFieldId"].as_str().unwrap_or(""))
            .copied()
            .ok_or("Unknown link field")?;
        let link_field = table.fields[link_index];
        let target_table = self
            .table_ids
            .get(link_field["linkedTableId"].as_str().unwrap_or(""))
            .copied()
            .ok_or("Unknown linked table")?;
        let target_field = self.tables[target_table]
            .field_ids
            .get(field["targetFieldId"].as_str().unwrap_or(""))
            .copied()
            .ok_or("Unknown target field")?;
        let linked_ids = self.cell((table_index, record_index, link_index), depth + 1)?;
        let mut linked_values = Vec::new();
        for record_id in linked_ids.as_array().into_iter().flatten() {
            let record_id = record_id.as_str().ok_or("Invalid linked record ID")?;
            let target_record = self.tables[target_table]
                .record_ids
                .get(record_id)
                .copied()
                .ok_or_else(|| format!("Linked record '{record_id}' was deleted"))?;
            linked_values.push(
                self.cell((target_table, target_record, target_field), depth + 1)
                    .map_err(|error| format!("Linked record '{record_id}': {error}"))?,
            );
        }
        if kind == "lookup" {
            let mut strings = Vec::new();
            for value in linked_values {
                match value {
                    Value::Null => {}
                    Value::Array(values) => strings.extend(
                        values
                            .iter()
                            .filter(|value| !value.is_null())
                            .map(|value| Value::String(formula::display(value))),
                    ),
                    other => strings.push(Value::String(formula::display(&other))),
                }
            }
            Ok(Value::Array(strings))
        } else {
            formula::aggregate(field["aggregation"].as_str().unwrap_or(""), &linked_values)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(id: &str, name: &str, kind: &str) -> Value {
        json!({"id":id, "name":name, "type":kind, "width":180})
    }

    fn formula_field(id: &str, name: &str, expression: &str) -> Value {
        let mut result = field(id, name, "formula");
        result["formula"] = json!(expression);
        result
    }

    fn record(id: &str, cells: Value) -> Value {
        json!({"id":id, "cells":cells, "createdAt":"2026-10-13T00:00:00Z", "updatedAt":"2026-10-13T00:00:00Z"})
    }

    fn table(id: &str, fields: Vec<Value>, records: Vec<Value>) -> Value {
        json!({"id":id, "name":id, "fields":fields, "records":records, "views":[]})
    }

    fn workspace(tables: Vec<Value>) -> Value {
        json!({"version":1,"name":"Tests","bases":[{"id":"base","name":"Test base","color":"blue","description":"","tables":tables}]})
    }

    fn calculation(expression: &str) -> Value {
        let document = workspace(vec![table(
            "t",
            vec![formula_field("f", "Result", expression)],
            vec![record("r", json!({}))],
        )]);
        evaluate_workspace(&document)
    }

    #[test]
    fn arithmetic_precedence_and_parentheses() {
        for (expression, expected) in [
            ("2 + 3 * 4", 14.0),
            ("(2 + 3) * 4", 20.0),
            ("12 / 3 / 2", 2.0),
            ("-2 * -3 + 1", 7.0),
            (".5 + 2e2", 200.5),
        ] {
            let result = calculation(expression);
            assert_eq!(
                result["values"]["t"]["r"]["f"], expected,
                "{expression}: {result}"
            );
            assert_eq!(result["errors"], json!({}));
        }
    }

    #[test]
    fn dependencies_recalculate_from_each_snapshot() {
        // Put the dependent field first to prove evaluation is not array-order based.
        let mut document = workspace(vec![table(
            "t",
            vec![
                formula_field("grand", "Grand total", "{Subtotal} * 1.1"),
                field("quantity", "Quantity", "number"),
                formula_field("subtotal", "Subtotal", "{Quantity} * 20"),
            ],
            vec![record("r", json!({"quantity":2}))],
        )]);
        let before = document.clone();
        assert_eq!(
            evaluate_workspace(&document)["values"]["t"]["r"]["grand"],
            44.0
        );
        assert_eq!(document, before, "Evaluation must not mutate saved cells");
        document["bases"][0]["tables"][0]["records"][0]["cells"]["quantity"] = json!(3);
        assert_eq!(
            evaluate_workspace(&document)["values"]["t"]["r"]["grand"],
            66.0
        );
    }

    #[test]
    fn cycles_and_errors_are_local_to_affected_fields() {
        let document = workspace(vec![table(
            "t",
            vec![
                formula_field("a", "A", "{B} + 1"),
                formula_field("b", "B", "{A} + 1"),
                formula_field("good", "Good", "42"),
                formula_field("bad", "Bad", "1 / 0"),
            ],
            vec![record("r", json!({}))],
        )]);
        let result = evaluate_workspace(&document);
        assert!(result["errors"]["t"]["r"]["a"]
            .as_str()
            .unwrap()
            .contains("Circular"));
        assert!(result["errors"]["t"]["r"]["b"]
            .as_str()
            .unwrap()
            .contains("Circular"));
        assert_eq!(result["errors"]["t"]["r"]["bad"], "Division by zero");
        assert_eq!(result["values"]["t"]["r"]["good"], 42.0);
    }

    #[test]
    fn lookups_and_rollups_use_linked_records_and_calculated_targets() {
        let mut links = field("links", "Orders", "link");
        links["linkedTableId"] = json!("orders");
        let mut total = field("total", "Total", "rollup");
        total["linkFieldId"] = json!("links");
        total["targetFieldId"] = json!("amount");
        total["aggregation"] = json!("SUM");
        let mut lookup = field("lookup", "Order totals", "lookup");
        lookup["linkFieldId"] = json!("links");
        lookup["targetFieldId"] = json!("amount");
        let document = workspace(vec![
            table(
                "customers",
                vec![links, total, lookup],
                vec![
                    record("customer", json!({"links":["order1","order2"]})),
                    record("empty", json!({})),
                ],
            ),
            table(
                "orders",
                vec![
                    field("qty", "Quantity", "number"),
                    formula_field("amount", "Amount", "{Quantity} * 10"),
                ],
                vec![
                    record("order1", json!({"qty":2})),
                    record("order2", json!({"qty":3})),
                ],
            ),
        ]);
        let result = evaluate_workspace(&document);
        assert_eq!(result["errors"], json!({}));
        assert_eq!(result["values"]["customers"]["customer"]["total"], 50.0);
        assert_eq!(
            result["values"]["customers"]["customer"]["lookup"],
            json!(["20", "30"])
        );
        assert_eq!(result["values"]["customers"]["empty"]["total"], 0.0);
        assert_eq!(result["values"]["customers"]["empty"]["lookup"], json!([]));
    }

    #[test]
    fn functions_and_strings_use_lazy_conditions_and_unicode_characters() {
        for (expression, expected) in [
            (
                "IF(2 >= 1, UPPER(TRIM(' café ')) & '!', 1/0)",
                json!("CAFÉ!"),
            ),
            (
                "IF(AND(TRUE(), NOT(FALSE), 3 != 4), ROUND(2.345, 2), 0)",
                json!(2.35),
            ),
            ("OR(TRUE, 1/0)", json!(true)),
            ("LEFT('éclair', 2) & RIGHT('東京', 1)", json!("éc京")),
            ("LEN('東京')", json!(2.0)),
            (
                "SUM(1, 2, 3) + AVERAGE(2, 4) + MIN(4, 2) + MAX(1, 5)",
                json!(16.0),
            ),
            (
                "YEAR('2024-02-29') + MONTH('2024-02-29') + DAY('2024-02-29')",
                json!(2055.0),
            ),
            (
                "COUNT(1, '2', 'hello', BLANK()) + COUNTA('hello', FALSE(), BLANK(), '')",
                json!(4.0),
            ),
            ("LOWER(CONCATENATE('A', ABS(-2)))", json!("a2")),
        ] {
            let result = calculation(expression);
            assert_eq!(
                result["values"]["t"]["r"]["f"], expected,
                "{expression}: {result}"
            );
        }
    }

    #[test]
    fn invalid_formula_does_not_invalidate_document() {
        let document = workspace(vec![table(
            "t",
            vec![formula_field("f", "Broken", "IF(")],
            vec![record("r", json!({}))],
        )]);
        assert!(validate_workspace(&document).is_ok());
        assert!(evaluate_workspace(&document)["errors"]["t"]["r"]["f"].is_string());
    }

    #[test]
    fn malformed_documents_duplicate_ids_wrong_types_and_dangling_links_are_rejected() {
        assert!(validate_workspace(&Value::Null).is_err());
        assert!(evaluate_workspace(&json!({}))["error"].is_string());
        let mut document = workspace(vec![table(
            "t",
            vec![field("f", "Amount", "number")],
            vec![record("r", json!({"f":"no"}))],
        )]);
        assert!(validate_workspace(&document)
            .unwrap_err()
            .contains("finite number"));
        document["bases"][0]["tables"][0]["records"][0]["cells"] = json!({"f":10});
        assert!(validate_workspace(&document).is_ok());
        document["bases"][0]["tables"][0]["records"][0]["id"] = json!("f");
        assert!(validate_workspace(&document)
            .unwrap_err()
            .contains("Duplicate ID"));
        document["bases"][0]["tables"][0]["records"][0]["id"] = json!("r");
        document["bases"][0]["tables"][0]["fields"][0]["type"] = json!("link");
        document["bases"][0]["tables"][0]["fields"][0]["linkedTableId"] = json!("t");
        document["bases"][0]["tables"][0]["records"][0]["cells"] = json!({"f":["missing"]});
        assert!(validate_workspace(&document)
            .unwrap_err()
            .contains("Dangling link"));
    }

    #[test]
    fn real_calendar_dates_and_computed_storage_are_validated() {
        let mut document = workspace(vec![table(
            "t",
            vec![field("f", "Date", "date")],
            vec![record("r", json!({"f":"2025-02-29"}))],
        )]);
        assert!(validate_workspace(&document).is_err());
        document["bases"][0]["tables"][0]["records"][0]["cells"]["f"] = json!("2024-02-29");
        assert!(validate_workspace(&document).is_ok());
        document["bases"][0]["tables"][0]["fields"][0] = formula_field("f", "Date", "TODAY()");
        assert!(validate_workspace(&document)
            .unwrap_err()
            .contains("must not be stored"));
        document["bases"][0]["tables"][0]["records"][0]["cells"] = json!({});
        let date = evaluate_workspace(&document)["values"]["t"]["r"]["f"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(crate::validation::date_parts(&date).is_some());
    }

    #[test]
    fn empty_workspaces_and_tables_are_valid() {
        assert!(validate_workspace(&json!({"version":1,"name":"Empty","bases":[]})).is_ok());
        let document = workspace(vec![table("t", vec![], vec![])]);
        assert!(validate_workspace(&document).is_ok());
        assert_eq!(
            evaluate_workspace(&document),
            json!({"values":{"t":{}},"errors":{}})
        );
    }

    #[test]
    fn dependency_depth_limit_does_not_poison_shorter_independent_chains() {
        let fields = (0..135)
            .map(|i| {
                formula_field(
                    &format!("f{i}"),
                    &format!("F{i}"),
                    &if i == 134 {
                        "1".to_owned()
                    } else {
                        format!("{{F{}}} + 1", i + 1)
                    },
                )
            })
            .collect();
        let result = evaluate_workspace(&workspace(vec![table(
            "t",
            fields,
            vec![record("r", json!({}))],
        )]));
        assert!(result["errors"]["t"]["r"]["f0"]
            .as_str()
            .unwrap()
            .contains("chain exceeds"));
        assert_eq!(result["values"]["t"]["r"]["f10"], 125.0);
        assert_eq!(result["values"]["t"]["r"]["f134"], 1.0);
    }

    #[test]
    fn structural_limits_and_view_references_are_validated() {
        let fields = (0..201)
            .map(|i| field(&format!("f{i}"), &format!("Field {i}"), "text"))
            .collect();
        let mut document = workspace(vec![table("t", fields, vec![])]);
        assert!(validate_workspace(&document)
            .unwrap_err()
            .contains("200 field limit"));
        document["bases"][0]["tables"][0]["fields"] = json!([field("f", "Name", "text")]);
        document["bases"][0]["tables"][0]["views"] = json!([{
            "id":"v","name":"Grid","type":"grid","filters":[],"filterMode":"and",
            "sorts":[{"fieldId":"missing","direction":"asc"}],"hiddenFields":[],"rowHeight":"compact"
        }]);
        assert!(validate_workspace(&document)
            .unwrap_err()
            .contains("unknown field"));
    }

    #[test]
    fn malformed_or_deep_formulas_return_cell_errors_without_panics() {
        for expression in [
            "{{}",
            "'unclosed",
            "IF(TRUE)",
            "LEFT('hi', -1)",
            "UNKNOWN(1)",
            "1e999",
            "{missing}",
            "YEAR('2025-02-29')",
        ] {
            let result = calculation(expression);
            assert!(
                result["errors"]["t"]["r"]["f"].is_string(),
                "{expression}: {result}"
            );
        }
        let expression = format!("{}1{}", "(".repeat(150), ")".repeat(150));
        assert!(calculation(&expression)["errors"]["t"]["r"]["f"]
            .as_str()
            .unwrap()
            .contains("nesting"));
    }

    #[test]
    fn declared_inverse_links_require_mutual_schema_and_record_membership() {
        let mut forward = field("a-b", "B records", "link");
        forward["linkedTableId"] = json!("b");
        forward["inverseFieldId"] = json!("b-a");
        let mut inverse = field("b-a", "A records", "link");
        inverse["linkedTableId"] = json!("a");
        inverse["inverseFieldId"] = json!("a-b");
        let mut document = workspace(vec![
            table(
                "a",
                vec![forward],
                vec![record("a1", json!({"a-b":["b1"]}))],
            ),
            table(
                "b",
                vec![inverse],
                vec![record("b1", json!({"b-a":["a1"]}))],
            ),
        ]);
        assert!(validate_workspace(&document).is_ok());
        document["bases"][0]["tables"][1]["records"][0]["cells"]["b-a"] = json!([]);
        assert!(validate_workspace(&document)
            .unwrap_err()
            .contains("reciprocal link is missing"));
        document["bases"][0]["tables"][1]["records"][0]["cells"]["b-a"] = json!(["a1"]);
        document["bases"][0]["tables"][1]["fields"][0]["inverseFieldId"] = json!("missing");
        assert!(validate_workspace(&document).is_err());
        // Deliberately one-way links remain supported when neither declares an inverse.
        document["bases"][0]["tables"][0]["fields"][0]
            .as_object_mut()
            .unwrap()
            .remove("inverseFieldId");
        document["bases"][0]["tables"][1]["fields"][0]
            .as_object_mut()
            .unwrap()
            .remove("inverseFieldId");
        document["bases"][0]["tables"][1]["records"][0]["cells"]["b-a"] = json!([]);
        assert!(validate_workspace(&document).is_ok());
    }
}
