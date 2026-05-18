use serde::{Deserialize, Serialize};

const GEOCODING_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherLocation {
    pub name: String,
    pub country: String,
    pub admin1: Option<String>,
    pub timezone: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherDay {
    pub date: String,
    pub weather_code: i32,
    pub summary: String,
    pub temperature_max_c: f64,
    pub temperature_min_c: f64,
    pub precipitation_probability_max: Option<u32>,
    pub precipitation_sum_mm: f64,
    pub wind_speed_max_kmh: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherForecast {
    pub location: WeatherLocation,
    pub days: Vec<WeatherDay>,
}

#[derive(Debug, Deserialize)]
struct GeocodingResponse {
    results: Option<Vec<GeocodingResult>>,
}

#[derive(Debug, Deserialize)]
struct GeocodingResult {
    name: String,
    country: Option<String>,
    admin1: Option<String>,
    timezone: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
struct ForecastResponse {
    daily: ForecastDaily,
}

#[derive(Debug, Deserialize)]
struct ForecastDaily {
    time: Vec<String>,
    weather_code: Vec<i32>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    precipitation_sum: Vec<f64>,
    #[serde(default)]
    precipitation_probability_max: Vec<Option<u32>>,
    wind_speed_10m_max: Vec<f64>,
}

fn weather_code_description(code: i32) -> &'static str {
    match code {
        0 => "Clear sky",
        1 => "Mostly clear",
        2 => "Partly cloudy",
        3 => "Overcast",
        45 | 48 => "Fog",
        51 => "Light drizzle",
        53 => "Drizzle",
        55 => "Dense drizzle",
        56 | 57 => "Freezing drizzle",
        61 => "Light rain",
        63 => "Rain",
        65 => "Heavy rain",
        66 | 67 => "Freezing rain",
        71 => "Light snow",
        73 => "Snow",
        75 => "Heavy snow",
        77 => "Snow grains",
        80 => "Light showers",
        81 => "Showers",
        82 => "Heavy showers",
        85 => "Light snow showers",
        86 => "Heavy snow showers",
        95 => "Thunderstorm",
        96 | 99 => "Thunderstorm with hail",
        _ => "Unspecified conditions",
    }
}

async fn geocode_location(query: &str) -> Result<WeatherLocation, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Could not prepare weather lookup: {}", e))?;

    let body: GeocodingResponse = client
        .get(GEOCODING_URL)
        .query(&[
            ("name", query),
            ("count", "5"),
            ("language", "en"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("Weather location search failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Could not read weather location search: {}", e))?;

    let result = body
        .results
        .and_then(|mut results| results.drain(..).next())
        .ok_or_else(|| format!("No weather location matched '{}'.", query))?;

    Ok(WeatherLocation {
        name: result.name,
        country: result.country.unwrap_or_default(),
        admin1: result.admin1,
        timezone: result.timezone,
        latitude: result.latitude,
        longitude: result.longitude,
    })
}

pub async fn fetch_weather_forecast(
    location_query: &str,
    forecast_days: u32,
) -> Result<WeatherForecast, String> {
    let query = location_query.trim();
    if query.is_empty() {
        return Err("Weather location is required.".to_string());
    }
    let forecast_days = forecast_days.clamp(1, 10);
    let location = geocode_location(query).await?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Could not prepare weather forecast request: {}", e))?;

    let body: ForecastResponse = client
        .get(FORECAST_URL)
        .query(&[
            ("latitude", location.latitude.to_string()),
            ("longitude", location.longitude.to_string()),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max".to_string(),
            ),
            ("forecast_days", forecast_days.to_string()),
            ("timezone", "auto".to_string()),
            ("temperature_unit", "celsius".to_string()),
            ("wind_speed_unit", "kmh".to_string()),
            ("precipitation_unit", "mm".to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Weather forecast request failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Could not read weather forecast: {}", e))?;

    let daily = body.daily;
    let mut days = Vec::new();
    for index in 0..daily.time.len() {
        let weather_code = *daily.weather_code.get(index).unwrap_or(&-1);
        days.push(WeatherDay {
            date: daily.time.get(index).cloned().unwrap_or_default(),
            weather_code,
            summary: weather_code_description(weather_code).to_string(),
            temperature_max_c: *daily.temperature_2m_max.get(index).unwrap_or(&0.0),
            temperature_min_c: *daily.temperature_2m_min.get(index).unwrap_or(&0.0),
            precipitation_probability_max: daily
                .precipitation_probability_max
                .get(index)
                .cloned()
                .flatten(),
            precipitation_sum_mm: *daily.precipitation_sum.get(index).unwrap_or(&0.0),
            wind_speed_max_kmh: *daily.wind_speed_10m_max.get(index).unwrap_or(&0.0),
        });
    }

    Ok(WeatherForecast { location, days })
}
