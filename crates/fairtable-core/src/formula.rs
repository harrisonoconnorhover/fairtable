use crate::validation::date_parts;
use serde_json::{Number, Value};

const MAX_DEPTH: usize = 128;

#[derive(Clone, Debug)]
pub(crate) enum Expr {
    Literal(Value),
    Field(String),
    Unary(char, Box<Expr>),
    Binary(String, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Text(String),
    Field(String),
    Name(String),
    Operator(String),
    Open,
    Close,
    Comma,
    End,
}

pub(crate) fn parse(expression: &str) -> Result<Expr, String> {
    if expression.trim().is_empty() {
        return Err("Enter a formula".into());
    }
    if expression.len() > 8192 {
        return Err("Formula exceeds 8192 bytes".into());
    }
    let tokens = tokenize(expression)?;
    let mut parser = Parser {
        tokens,
        position: 0,
    };
    let result = parser.expression(0, 0)?;
    if parser.peek() != &Token::End {
        return Err("Unexpected content after expression".into());
    }
    Ok(result)
}

fn tokenize(text: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut position = 0;
    let mut tokens = Vec::new();
    while let Some(&ch) = chars.get(position) {
        if ch.is_whitespace() {
            position += 1;
            continue;
        }
        let token = match ch {
            '(' => {
                position += 1;
                Token::Open
            }
            ')' => {
                position += 1;
                Token::Close
            }
            ',' => {
                position += 1;
                Token::Comma
            }
            '{' => {
                position += 1;
                let start = position;
                while chars.get(position).is_some_and(|ch| *ch != '}') {
                    position += 1;
                }
                if chars.get(position) != Some(&'}') {
                    return Err("Unclosed field reference".into());
                }
                let name: String = chars[start..position].iter().collect();
                position += 1;
                if name.trim().is_empty() {
                    return Err("Field reference is empty".into());
                }
                Token::Field(name)
            }
            '"' | '\'' => {
                let quote = ch;
                position += 1;
                let mut value = String::new();
                let mut closed = false;
                while let Some(&next) = chars.get(position) {
                    position += 1;
                    if next == quote {
                        closed = true;
                        break;
                    }
                    if next == '\\' {
                        let escaped = chars.get(position).ok_or("Unclosed string escape")?;
                        value.push(match escaped {
                            'n' => '\n',
                            'r' => '\r',
                            't' => '\t',
                            other => *other,
                        });
                        position += 1;
                    } else {
                        value.push(next);
                    }
                }
                if !closed {
                    return Err("Unclosed string literal".into());
                }
                Token::Text(value)
            }
            '0'..='9' | '.' => {
                let start = position;
                while chars.get(position).is_some_and(|ch| ch.is_ascii_digit()) {
                    position += 1;
                }
                if chars.get(position) == Some(&'.') {
                    position += 1;
                    while chars.get(position).is_some_and(|ch| ch.is_ascii_digit()) {
                        position += 1;
                    }
                }
                if chars
                    .get(position)
                    .is_some_and(|ch| *ch == 'e' || *ch == 'E')
                {
                    position += 1;
                    if chars
                        .get(position)
                        .is_some_and(|ch| *ch == '+' || *ch == '-')
                    {
                        position += 1;
                    }
                    while chars.get(position).is_some_and(|ch| ch.is_ascii_digit()) {
                        position += 1;
                    }
                }
                let value: String = chars[start..position].iter().collect();
                let number = value
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid number '{value}'"))?;
                if !number.is_finite() {
                    return Err("Number is out of range".into());
                }
                Token::Number(number)
            }
            '+' | '-' | '*' | '/' | '&' | '=' | '!' | '>' | '<' => {
                position += 1;
                let mut operator = ch.to_string();
                if matches!(ch, '=' | '!' | '>' | '<') && chars.get(position) == Some(&'=') {
                    operator.push('=');
                    position += 1;
                }
                if operator == "!" {
                    return Err("Use NOT(value) or !=".into());
                }
                if operator == "==" {
                    operator = "=".into();
                }
                Token::Operator(operator)
            }
            ch if ch.is_ascii_alphabetic() || ch == '_' => {
                let start = position;
                while chars
                    .get(position)
                    .is_some_and(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
                {
                    position += 1;
                }
                Token::Name(
                    chars[start..position]
                        .iter()
                        .collect::<String>()
                        .to_ascii_uppercase(),
                )
            }
            _ => return Err(format!("Unexpected character '{ch}'")),
        };
        tokens.push(token);
        if tokens.len() > 2048 {
            return Err("Formula is too complex (2048 token limit)".into());
        }
    }
    tokens.push(Token::End);
    Ok(tokens)
}

struct Parser {
    tokens: Vec<Token>,
    position: usize,
}

impl Parser {
    fn peek(&self) -> &Token {
        self.tokens.get(self.position).unwrap_or(&Token::End)
    }

    fn next(&mut self) -> Token {
        let value = self.peek().clone();
        self.position += 1;
        value
    }

    fn expression(&mut self, minimum: u8, depth: usize) -> Result<Expr, String> {
        if depth > MAX_DEPTH {
            return Err("Formula nesting exceeds 128 levels".into());
        }
        let mut left = match self.next() {
            Token::Number(number) => Expr::Literal(finite(number)?),
            Token::Text(text) => Expr::Literal(Value::String(text)),
            Token::Field(name) => Expr::Field(name),
            Token::Operator(operator) if operator == "+" || operator == "-" => Expr::Unary(
                if operator == "-" { '-' } else { '+' },
                Box::new(self.expression(5, depth + 1)?),
            ),
            Token::Open => {
                let inner = self.expression(0, depth + 1)?;
                if self.next() != Token::Close {
                    return Err("Expected closing parenthesis".into());
                }
                inner
            }
            Token::Name(name) => {
                if self.peek() == &Token::Open {
                    self.next();
                    let mut args = Vec::new();
                    if self.peek() != &Token::Close {
                        loop {
                            args.push(self.expression(0, depth + 1)?);
                            if self.peek() != &Token::Comma {
                                break;
                            }
                            self.next();
                        }
                    }
                    if self.next() != Token::Close {
                        return Err(format!("Expected closing parenthesis for {name}"));
                    }
                    Expr::Call(name, args)
                } else {
                    match name.as_str() {
                        "TRUE" => Expr::Literal(Value::Bool(true)),
                        "FALSE" => Expr::Literal(Value::Bool(false)),
                        "BLANK" => Expr::Literal(Value::Null),
                        _ => {
                            return Err(format!(
                                "Unknown name '{name}'; use {{Field name}} for a field"
                            ))
                        }
                    }
                }
            }
            _ => return Err("Expected a number, text, field, or function".into()),
        };
        while let Token::Operator(operator) = self.peek() {
            let precedence = match operator.as_str() {
                "=" | "!=" | ">" | "<" | ">=" | "<=" => 1,
                "&" => 2,
                "+" | "-" => 3,
                "*" | "/" => 4,
                _ => break,
            };
            if precedence < minimum {
                break;
            }
            let operator = operator.clone();
            self.next();
            let right = self.expression(precedence + 1, depth + 1)?;
            left = Expr::Binary(operator, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
}

pub(crate) fn evaluate(
    expr: &Expr,
    resolve: &mut impl FnMut(&str) -> Result<Value, String>,
) -> Result<Value, String> {
    eval(expr, resolve, 0)
}

fn eval(
    expr: &Expr,
    resolve: &mut impl FnMut(&str) -> Result<Value, String>,
    depth: usize,
) -> Result<Value, String> {
    if depth > MAX_DEPTH {
        return Err("Formula evaluation exceeds 128 levels".into());
    }
    match expr {
        Expr::Literal(value) => Ok(value.clone()),
        Expr::Field(name) => resolve(name),
        Expr::Unary(operator, inner) => {
            let number = numeric(&eval(inner, resolve, depth + 1)?)?;
            finite(if *operator == '-' { -number } else { number })
        }
        Expr::Binary(operator, left, right) => {
            let left = eval(left, resolve, depth + 1)?;
            let right = eval(right, resolve, depth + 1)?;
            match operator.as_str() {
                "+" => finite(numeric(&left)? + numeric(&right)?),
                "-" => finite(numeric(&left)? - numeric(&right)?),
                "*" => finite(numeric(&left)? * numeric(&right)?),
                "/" => {
                    let denominator = numeric(&right)?;
                    if denominator == 0.0 {
                        return Err("Division by zero".into());
                    }
                    finite(numeric(&left)? / denominator)
                }
                "&" => bounded_text(format!("{}{}", display(&left), display(&right))),
                "=" => Ok(Value::Bool(equal(&left, &right))),
                "!=" => Ok(Value::Bool(!equal(&left, &right))),
                ">" | "<" | ">=" | "<=" => {
                    let order = if left.is_number() && right.is_number() {
                        numeric(&left)?
                            .partial_cmp(&numeric(&right)?)
                            .ok_or("Cannot compare numbers")?
                    } else {
                        display(&left).cmp(&display(&right))
                    };
                    Ok(Value::Bool(match operator.as_str() {
                        ">" => order.is_gt(),
                        "<" => order.is_lt(),
                        ">=" => order.is_ge(),
                        _ => order.is_le(),
                    }))
                }
                _ => Err("Unknown operator".into()),
            }
        }
        Expr::Call(name, args) => {
            // Branching functions only evaluate expressions they actually need.
            match name.as_str() {
                "IF" => {
                    arity(name, args.len(), 2, 3)?;
                    if truthy(&eval(&args[0], resolve, depth + 1)?) {
                        return eval(&args[1], resolve, depth + 1);
                    }
                    return args
                        .get(2)
                        .map_or(Ok(Value::Null), |arg| eval(arg, resolve, depth + 1));
                }
                "AND" | "OR" => {
                    for arg in args {
                        let value = truthy(&eval(arg, resolve, depth + 1)?);
                        if name == "AND" && !value {
                            return Ok(Value::Bool(false));
                        }
                        if name == "OR" && value {
                            return Ok(Value::Bool(true));
                        }
                    }
                    return Ok(Value::Bool(name == "AND"));
                }
                _ => {}
            }
            let values = args
                .iter()
                .map(|arg| eval(arg, resolve, depth + 1))
                .collect::<Result<Vec<_>, _>>()?;
            function(name, &values)
        }
    }
}

fn equal(left: &Value, right: &Value) -> bool {
    if left.is_number() && right.is_number() {
        left.as_f64() == right.as_f64()
    } else {
        left == right
    }
}

fn arity(name: &str, actual: usize, minimum: usize, maximum: usize) -> Result<(), String> {
    if actual < minimum || actual > maximum {
        return Err(format!(
            "{name} expects {} argument(s)",
            if minimum == maximum {
                minimum.to_string()
            } else {
                format!("{minimum} to {maximum}")
            }
        ));
    }
    Ok(())
}

pub(crate) fn finite(value: f64) -> Result<Value, String> {
    Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| "Numeric result is out of range".into())
}

pub(crate) fn numeric(value: &Value) -> Result<f64, String> {
    let number = match value {
        Value::Null => Some(0.0),
        Value::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
        Value::Number(value) => value.as_f64(),
        Value::String(value) if value.trim().is_empty() => Some(0.0),
        Value::String(value) => value.trim().parse::<f64>().ok(),
        _ => None,
    };
    number.filter(|n| n.is_finite()).ok_or_else(|| {
        format!(
            "Expected a number, received '{}'",
            display(value).chars().take(80).collect::<String>()
        )
    })
}

pub(crate) fn display(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Bool(value) => if *value { "1" } else { "0" }.into(),
        Value::Array(values) => values.iter().map(display).collect::<Vec<_>>().join(", "),
        Value::Number(number) => number
            .as_f64()
            .map_or_else(|| number.to_string(), |n| n.to_string()),
        other => other.to_string(),
    }
}

pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|n| n != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(_) => false,
    }
}

fn bounded_text(text: String) -> Result<Value, String> {
    if text.len() > 1_048_576 {
        return Err("Calculated text exceeds the 1 MiB limit".into());
    }
    Ok(Value::String(text))
}

fn flatten<'a>(values: &'a [Value], out: &mut Vec<&'a Value>) {
    for value in values {
        if let Value::Array(items) = value {
            flatten(items, out);
        } else {
            out.push(value);
        }
    }
}

pub(crate) fn aggregate(name: &str, values: &[Value]) -> Result<Value, String> {
    let mut flat = Vec::new();
    flatten(values, &mut flat);
    let numbers: Vec<f64> = flat
        .iter()
        .filter_map(|value| {
            if value.is_null()
                || value.is_boolean()
                || value.as_str().is_some_and(|s| s.trim().is_empty())
            {
                None
            } else {
                numeric(value).ok()
            }
        })
        .collect();
    match name {
        "SUM" => finite(numbers.iter().sum()),
        "AVERAGE" => {
            if numbers.is_empty() {
                Ok(Value::Null)
            } else {
                finite(numbers.iter().sum::<f64>() / numbers.len() as f64)
            }
        }
        "MIN" => numbers
            .iter()
            .copied()
            .reduce(f64::min)
            .map_or(Ok(Value::Null), finite),
        "MAX" => numbers
            .iter()
            .copied()
            .reduce(f64::max)
            .map_or(Ok(Value::Null), finite),
        "COUNT" => finite(numbers.len() as f64),
        "COUNTA" => finite(
            flat.iter()
                .filter(|value| !value.is_null() && !value.as_str().is_some_and(str::is_empty))
                .count() as f64,
        ),
        "ARRAYJOIN" => bounded_text(
            flat.iter()
                .filter(|value| !value.is_null())
                .map(|value| display(value))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        _ => Err(format!("Unsupported aggregation '{name}'")),
    }
}

fn function(name: &str, values: &[Value]) -> Result<Value, String> {
    match name {
        "SUM" | "AVERAGE" | "MIN" | "MAX" | "COUNT" | "COUNTA" => aggregate(name, values),
        "CONCATENATE" => bounded_text(values.iter().map(display).collect()),
        "TRUE" | "FALSE" | "BLANK" | "TODAY" => {
            arity(name, values.len(), 0, 0)?;
            match name {
                "TRUE" => Ok(Value::Bool(true)),
                "FALSE" => Ok(Value::Bool(false)),
                "BLANK" => Ok(Value::Null),
                _ => bounded_text(today()?),
            }
        }
        "ROUND" => {
            arity(name, values.len(), 1, 2)?;
            let precision = values.get(1).map_or(Ok(0.0), numeric)?;
            if precision.fract() != 0.0 || !(-15.0..=15.0).contains(&precision) {
                return Err("ROUND precision must be an integer from -15 to 15".into());
            }
            let factor = 10_f64.powi(precision as i32);
            finite((numeric(&values[0])? * factor).round() / factor)
        }
        "LEFT" | "RIGHT" => {
            arity(name, values.len(), 1, 2)?;
            let count = values.get(1).map_or(Ok(1.0), numeric)?;
            if count < 0.0 || count.fract() != 0.0 || count > 1_048_576.0 {
                return Err(format!(
                    "{name} length must be a nonnegative integer up to 1048576"
                ));
            }
            let text = display(&values[0]);
            let count = count as usize;
            bounded_text(if name == "LEFT" {
                text.chars().take(count).collect()
            } else {
                text.chars()
                    .skip(text.chars().count().saturating_sub(count))
                    .collect()
            })
        }
        "NOT" | "ABS" | "UPPER" | "LOWER" | "LEN" | "TRIM" | "YEAR" | "MONTH" | "DAY" => {
            arity(name, values.len(), 1, 1)?;
            let value = &values[0];
            match name {
                "NOT" => Ok(Value::Bool(!truthy(value))),
                "ABS" => finite(numeric(value)?.abs()),
                "UPPER" => bounded_text(display(value).to_uppercase()),
                "LOWER" => bounded_text(display(value).to_lowercase()),
                "LEN" => finite(display(value).chars().count() as f64),
                "TRIM" => bounded_text(display(value).trim().to_owned()),
                _ => {
                    if value.is_null() {
                        return Ok(Value::Null);
                    }
                    let (year, month, day) =
                        date_parts(&display(value)).ok_or("Expected a valid YYYY-MM-DD date")?;
                    finite(match name {
                        "YEAR" => year as f64,
                        "MONTH" => month as f64,
                        _ => day as f64,
                    })
                }
            }
        }
        _ => Err(format!("Unknown function '{name}'")),
    }
}

fn today() -> Result<String, String> {
    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    let seconds = {
        #[wasm_bindgen::prelude::wasm_bindgen]
        extern "C" {
            #[wasm_bindgen::prelude::wasm_bindgen(js_namespace = Date, js_name = now)]
            fn date_now() -> f64;
        }
        date_now() / 1000.0
    };
    #[cfg(not(all(feature = "wasm", target_arch = "wasm32")))]
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "System date is before 1970")?
        .as_secs_f64();
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("System date is unavailable".into());
    }
    // Gregorian 400-year eras, starting from the Unix epoch's day number.
    let z = (seconds / 86400.0).floor() as i64 + 719468;
    let era = z / 146097;
    let day_of_era = z - era * 146097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_phase = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_phase + 2) / 5 + 1;
    let month = month_phase + if month_phase < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    Ok(format!("{year:04}-{month:02}-{day:02}"))
}
