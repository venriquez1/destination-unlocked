/**
 * Destination Unlocked (prototype)
 * End-to-end flow:
 * user inputs -> real NWS API requests -> calculated scores -> top five results
 *
 * NWS API flow per destination:
 * 1) GET https://api.weather.gov/points/{lat},{lon}
 * 2) Read properties.forecast (gridpoint forecast URL)
 * 3) GET forecast URL -> properties.periods[]
 *
 * Scoring:
 * A forecast period qualifies if:
 * - temperature within [minTemp, maxTemp]
 * - probabilityOfPrecipitation.value <= maxPrecip
 *
 * Preferred Weather Percentage (Score out of 100) =
 * (qualifying forecast periods / total valid forecast periods) * 100
 *
 * Important limitation:
 * NWS provides short-term forecasts (days ahead), not seasonal forecasts months in advance.
 * The "Travel Season" input is displayed as a preference label and does not change the forecast data.
 */

// -------------------- Predefined destinations (lat/lon) --------------------
const DESTINATIONS = [
  { name: "San Diego, CA", lat: 32.7157, lon: -117.1611 },
  { name: "Miami, FL", lat: 25.7617, lon: -80.1918 },
  { name: "New York City, NY", lat: 40.7128, lon: -74.006 },
  { name: "Chicago, IL", lat: 41.8781, lon: -87.6298 },
  { name: "Seattle, WA", lat: 47.6062, lon: -122.3321 },
  { name: "Denver, CO", lat: 39.7392, lon: -104.9903 },
  { name: "Phoenix, AZ", lat: 33.4484, lon: -112.074 },
  { name: "Las Vegas, NV", lat: 36.1699, lon: -115.1398 },
  { name: "Nashville, TN", lat: 36.1627, lon: -86.7816 },
  { name: "New Orleans, LA", lat: 29.9511, lon: -90.0715 },
  { name: "Honolulu, HI", lat: 21.3069, lon: -157.8583 },
  { name: "Anchorage, AK", lat: 61.2181, lon: -149.9003 }
];

// -------------------- DOM --------------------
const form = document.getElementById("prefsForm");
const minTempEl = document.getElementById("minTemp");
const maxTempEl = document.getElementById("maxTemp");
const maxPrecipEl = document.getElementById("maxPrecip");
const seasonEl = document.getElementById("season");

const runBtn = document.getElementById("runBtn");
const resetBtn = document.getElementById("resetBtn");

const statusEl = document.getElementById("status");
const selectedPrefsEl = document.getElementById("selectedPrefs");
const resultsEl = document.getElementById("results");
const explainEl = document.getElementById("explain");

// -------------------- UI helpers --------------------
function setStatus(type, html) {
  statusEl.className = `status ${type}`;
  statusEl.innerHTML = html;
}

function resetUI() {
  resultsEl.hidden = true;
  explainEl.hidden = true;
  selectedPrefsEl.hidden = true;

  resultsEl.innerHTML = "";
  explainEl.innerHTML = "";
  selectedPrefsEl.innerHTML = "";

  setStatus("idle", `Enter preferences and click <strong>Find My Top 5 Destinations</strong>.`);
}

function setBusy(isBusy) {
  runBtn.disabled = isBusy;
  resetBtn.disabled = isBusy;
  runBtn.textContent = isBusy ? "Loading forecasts..." : "Find My Top 5 Destinations";
}

function renderSelectedPrefs(prefs) {
  selectedPrefsEl.hidden = false;
  selectedPrefsEl.innerHTML = `
    <strong>Selected preferences:</strong>
    Temp ${prefs.minTemp}–${prefs.maxTemp}°F ·
    Max precip probability ${prefs.maxPrecip}% ·
    Travel season preference: ${prefs.season}
  `;
}

function renderResults(topFive) {
  resultsEl.hidden = false;

  resultsEl.innerHTML = topFive
    .map((d, idx) => {
      const scoreText = Number.isFinite(d.score) ? `${d.score.toFixed(1)}` : "—";

      const dataNote =
        d.validPeriods > 0
          ? `${d.qualifyingPeriods}/${d.validPeriods} forecast periods matched`
          : `Insufficient forecast data (missing precip probabilities)`;

      return `
        <div class="result-row">
          <div>
            <h3>#${idx + 1} ${d.name}</h3>
            <p class="meta">
              Score: <strong>${scoreText}/100</strong> · ${dataNote}<br/>
              Location: ${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}
            </p>
          </div>
          <div class="score">${scoreText}</div>
        </div>
      `;
    })
    .join("");
}

function renderExplanation(top) {
  explainEl.hidden = false;

  const why =
    top.validPeriods > 0
      ? `It had the highest Preferred Weather Percentage: <strong>${top.qualifyingPeriods}</strong> qualifying periods out of <strong>${top.validPeriods}</strong> valid forecast periods, for a score of <strong>${top.score.toFixed(1)}/100</strong>.`
      : `It ranked first among the fetched destinations, but note: it had <strong>0 valid periods</strong> (often due to missing precipitation probability values), so the score may not be meaningful. Try again later or adjust destinations.`;

  explainEl.innerHTML = `
    <strong>Why #1 ranked first:</strong> ${why}
    <div style="margin-top:8px; color: rgba(231,238,252,0.85);">
      Reminder: this is based on short-term NWS forecasts available right now; forecasts can change.
    </div>
  `;
}

// -------------------- Data helpers --------------------
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * NWS asks for a User-Agent identifying the app and contact info.
 * In browsers, we cannot set the actual User-Agent header, but we can send a custom header.
 * This is a reasonable browser-friendly approach for a student project.
 */
function nwsHeaders() {
  return {
    Accept: "application/geo+json",
    "User-Agent": "DestinationUnlockedClassProject (student project; contact: youremail@example.com)"
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: nwsHeaders() });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return await res.json();
}

/**
 * Get forecast periods for a lat/lon using:
 * points endpoint -> forecast URL -> periods array
 */
async function getForecastPeriods(lat, lon) {
  const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
  const pointsData = await fetchJson(pointsUrl);

  const forecastUrl = pointsData?.properties?.forecast;
  if (!forecastUrl) {
    throw new Error("Missing forecast URL from NWS points response.");
  }

  const forecastData = await fetchJson(forecastUrl);
  const periods = forecastData?.properties?.periods;

  if (!Array.isArray(periods)) {
    throw new Error("Missing forecast periods array.");
  }

  return periods;
}

/**
 * Compute score and stats for a destination.
 * We only count "valid" periods where:
 * - temperature is a number
 * - probabilityOfPrecipitation.value is a number (NWS often returns null)
 */
function scoreDestination(periods, prefs) {
  const { minTemp, maxTemp, maxPrecip } = prefs;

  let valid = 0;
  let qualifying = 0;

  for (const p of periods) {
    const temp = p?.temperature;
    const pop = p?.probabilityOfPrecipitation?.value;

    // If PoP is null/undefined, exclude from scoring to avoid guessing.
    if (!Number.isFinite(temp) || !Number.isFinite(pop)) continue;

    valid += 1;

    const tempOk = temp >= minTemp && temp <= maxTemp;
    const precipOk = pop <= maxPrecip;

    if (tempOk && precipOk) qualifying += 1;
  }

  const score = valid > 0 ? (qualifying / valid) * 100 : 0;

  return {
    score,
    validPeriods: valid,
    qualifyingPeriods: qualifying
  };
}

// -------------------- Main flow --------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  resetUI();

  // Read inputs
  let minTemp = toNumber(minTempEl.value, 60);
  let maxTemp = toNumber(maxTempEl.value, 70);
  let maxPrecip = toNumber(maxPrecipEl.value, 60);
  const season = seasonEl.value;

  // Validate / normalize
  maxPrecip = clamp(maxPrecip, 0, 100);

  // If user swapped min/max, fix it
  if (minTemp > maxTemp) {
    const tmp = minTemp;
    minTemp = maxTemp;
    maxTemp = tmp;
  }

  const prefs = { minTemp, maxTemp, maxPrecip, season };
  renderSelectedPrefs(prefs);

  setBusy(true);
  setStatus("loading", "Fetching NWS forecasts for destinations… This can take ~5–20 seconds.");

  try {
    // Fetch all destinations in parallel.
    // If some fail, we still show results for the ones that succeed.
    const tasks = DESTINATIONS.map(async (d) => {
      try {
        const periods = await getForecastPeriods(d.lat, d.lon);
        const stats = scoreDestination(periods, prefs);
        return { ...d, ...stats, ok: true };
      } catch (err) {
        return {
          ...d,
          ok: false,
          error: err?.message || "Unknown error",
          score: 0,
          validPeriods: 0,
          qualifyingPeriods: 0
        };
      }
    });

    const scored = await Promise.all(tasks);

    const successes = scored.filter((x) => x.ok);
    const failures = scored.filter((x) => !x.ok);

    // Sort by score desc, then validPeriods desc as a tie-breaker
    const ranked = [...successes].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.validPeriods || 0) - (a.validPeriods || 0);
    });

    const topFive = ranked.slice(0, 5);

    if (topFive.length === 0) {
      setStatus(
        "error",
        `No destinations returned usable forecast data right now.<br/>
         Try again later, or check your network connection.`
      );
      return;
    }

    if (failures.length > 0) {
      setStatus(
        "error",
        `Loaded ${successes.length}/${DESTINATIONS.length} destinations. Some requests failed (often temporary). Showing best available results.`
      );
    } else {
      setStatus("idle", `Done. Ranked ${successes.length} destinations and showing the top 5.`);
    }

    renderResults(topFive);
    renderExplanation(topFive[0]);

    // Debug info for you (optional)
    if (failures.length) {
      console.group("Destination Unlocked - failed destinations");
      failures.forEach((f) => console.log(f.name, f.error));
      console.groupEnd();
    }
  } catch (err) {
    setStatus("error", `Unexpected error: ${err?.message || err}`);
  } finally {
    setBusy(false);
  }
});

resetBtn.addEventListener("click", () => {
  minTempEl.value = 60;
  maxTempEl.value = 70;
  maxPrecipEl.value = 60;
  seasonEl.value = "Fall";
  resetUI();
});

// Initial UI
resetUI();
