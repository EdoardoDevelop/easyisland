// Periods named in a question («novembre», «mese scorso», «ieri»…), for the
// recipes (recipes.rs): a recipe learned on «spese di ottobre» keeps its dates
// as placeholders and fills them in for «spese di novembre». Fixed rules, no
// model; Italian and a few English words.

/// How long the period is: a recipe only takes a period of the same kind.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Span {
    Day,
    Week,
    Month,
    Year,
}

impl Span {
    pub fn name(self) -> &'static str {
        match self {
            Span::Day => "giorno",
            Span::Week => "settimana",
            Span::Month => "mese",
            Span::Year => "anno",
        }
    }
}

/// A period as dates "YYYY-MM-DD", both ends included.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Period {
    pub span: Span,
    pub start: String,
    pub end: String,
    /// The day after the end, for filters that stop before it.
    pub after: String,
}

const MONTHS: &[&[&str]] = &[
    &["gennaio", "january"],
    &["febbraio", "february"],
    &["marzo", "march"],
    &["aprile", "april"],
    &["maggio", "may"],
    &["giugno", "june"],
    &["luglio", "july"],
    &["agosto", "august"],
    &["settembre", "september"],
    &["ottobre", "october"],
    &["novembre", "november"],
    &["dicembre", "december"],
];

/// Words that only say which period: they never decide which recipe fits.
const WORDS: &[&str] = &[
    "oggi", "ieri", "domani", "settimana", "mese", "anno", "scorso", "scorsa", "corrente", "questo", "questa", "quest",
    "today", "yesterday", "week", "month", "year", "last", "this",
];

/// Days since 1970-01-01 (proleptic Gregorian).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn ymd(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn make(span: Span, first: i64, last: i64) -> Period {
    Period { span, start: ymd(first), end: ymd(last), after: ymd(last + 1) }
}

fn month(y: i64, m: i64) -> Period {
    let first = days_from_civil(y, m, 1);
    let next = if m == 12 { days_from_civil(y + 1, 1, 1) } else { days_from_civil(y, m + 1, 1) };
    make(Span::Month, first, next - 1)
}

fn year(y: i64) -> Period {
    make(Span::Year, days_from_civil(y, 1, 1), days_from_civil(y + 1, 1, 1) - 1)
}

/// Today on this PC, as days since 1970.
pub fn today() -> i64 {
    let n = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    days_from_civil(n.wYear as i64, n.wMonth as i64, n.wDay as i64)
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// The period a question names, as of `today` (days since 1970).
pub fn find(question: &str, today: i64) -> Option<Period> {
    let w = words(question);
    let has = |x: &str| w.iter().any(|a| a == x);
    let pair = |a: &str, b: &[&str]| w.windows(2).any(|p| (p[0] == a && b.contains(&p[1].as_str())) || (b.contains(&p[0].as_str()) && p[1] == a));
    let (ty, tm, _) = civil_from_days(today);
    let year_word = w.iter().filter_map(|a| a.parse::<i64>().ok()).find(|n| (1990..=2100).contains(n));
    // A month by name, with its year or the last one that had it.
    for (i, names) in MONTHS.iter().enumerate() {
        if names.iter().any(|n| has(n)) {
            let m = i as i64 + 1;
            let y = year_word.unwrap_or(if m > tm { ty - 1 } else { ty });
            return Some(month(y, m));
        }
    }
    if has("oggi") || has("today") {
        return Some(make(Span::Day, today, today));
    }
    if has("ieri") || has("yesterday") {
        return Some(make(Span::Day, today - 1, today - 1));
    }
    if has("domani") {
        return Some(make(Span::Day, today + 1, today + 1));
    }
    // Weeks start on Monday (1970-01-01 was a Thursday).
    let monday = today - (today + 3).rem_euclid(7);
    if pair("settimana", &["scorsa"]) || pair("week", &["last"]) {
        return Some(make(Span::Week, monday - 7, monday - 1));
    }
    if pair("settimana", &["questa"]) || pair("week", &["this"]) {
        return Some(make(Span::Week, monday, monday + 6));
    }
    if pair("mese", &["scorso"]) || pair("month", &["last"]) {
        return Some(if tm == 1 { month(ty - 1, 12) } else { month(ty, tm - 1) });
    }
    if pair("mese", &["questo", "corrente"]) || pair("month", &["this"]) {
        return Some(month(ty, tm));
    }
    if pair("anno", &["scorso"]) || pair("year", &["last"]) {
        return Some(year(ty - 1));
    }
    if pair("anno", &["quest", "questo", "corrente"]) || pair("year", &["this"]) {
        return Some(year(ty));
    }
    year_word.map(year)
}

/// Is this word only part of a period («novembre», «scorso», «2026»)?
pub fn is_period_word(word: &str) -> bool {
    let w = word.to_lowercase();
    WORDS.contains(&w.as_str())
        || MONTHS.iter().any(|names| names.contains(&w.as_str()))
        || w.parse::<i64>().is_ok_and(|n| (1990..=2100).contains(&n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(y: i64, m: i64, d: i64) -> i64 {
        days_from_civil(y, m, d)
    }

    #[test]
    fn dates_round_trip() {
        for z in [-1000, 0, 19000, 20771, 30000] {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        assert_eq!(ymd(day(2028, 2, 29)), "2028-02-29");
    }

    #[test]
    fn periods_from_words() {
        let now = day(2026, 11, 14); // a Saturday
        let p = find("Quanto ho speso a ottobre?", now).unwrap();
        assert_eq!((p.span, p.start.as_str(), p.end.as_str(), p.after.as_str()), (Span::Month, "2026-10-01", "2026-10-31", "2026-11-01"));
        // December asked in November: last year's.
        assert_eq!(find("spese di dicembre", now).unwrap().start, "2025-12-01");
        assert_eq!(find("spese di febbraio 2028", now).unwrap().end, "2028-02-29");
        assert_eq!(find("ticket di ieri", now).unwrap().start, "2026-11-13");
        let w = find("cosa ho fatto la settimana scorsa", now).unwrap();
        assert_eq!((w.start.as_str(), w.end.as_str()), ("2026-11-02", "2026-11-08"));
        assert_eq!(find("il mese scorso", day(2026, 1, 5)).unwrap().start, "2025-12-01");
        assert_eq!(find("fatture dell'anno scorso", now).unwrap().span, Span::Year);
        assert!(find("stato del computer", now).is_none());
        assert!(is_period_word("Novembre") && is_period_word("2026") && !is_period_word("spese"));
    }
}
