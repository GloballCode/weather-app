// script.js - full replacement
(function () {
  // DOM refs (keep the same IDs from your HTML)
  const input = document.getElementById('searchInput');
  const suggestions = document.getElementById('suggestions');
  const btn = document.getElementById('btnSearch');
  const hero = document.getElementById('hero');
  const heroLoading = document.getElementById('heroLoading');
  const heroResult = document.getElementById('heroResult');
  const noResults = document.getElementById('noResults');
  const errorBox = document.getElementById('errorBox');
  const cityNameEl = document.getElementById('cityName');
  const cityDateEl = document.getElementById('cityDate');
  const largeTemp = document.getElementById('largeTemp');
  const iconLarge = document.getElementById('iconLarge');
  const valFeels = document.getElementById('valFeels');
  const valHum = document.getElementById('valHum');
  const valWind = document.getElementById('valWind');
  const valPrecip = document.getElementById('valPrecip');
  const dailyRow = document.getElementById('dailyRow');
  const hourList = document.getElementById('hourList');

  // Units dropdown elements (existing in HTML)
  const unitsBtn = document.getElementById('unitsBtn');
  const dropdownMenu = document.getElementById('dropdownMenu');
  const sections = dropdownMenu ? Array.from(dropdownMenu.querySelectorAll('.dropdown-section')) : [];

  // default city requested by you
  const DEFAULT_CITY = 'Natal, Rio Grande do Norte, Brazil';
  // coordinates for Natal
  const DEFAULT_COORDS = { lat: -5.7945, lon: -35.211 };

  // state
  let lastQuery = null;      // last typed query string
  let lastCoords = null;     // {lat, lon}
  let lastPlaceLabel = null; // friendly label for last shown place
  let suppressUnitRefetch = true; // avoid refetch during initial UI setup

  // --- Overlay utilities (no layout changes to HTML) ---
  function removeOverlay() {
    const existing = document.getElementById('__app_error_overlay');
    if (existing) existing.remove();
    const page = document.querySelector('.page');
    if (page) page.style.filter = '';
  }

  function showOverlay({ title, message, onRetry }) {
    removeOverlay();
    const page = document.querySelector('.page');
    if (page) page.style.filter = 'brightness(0.5)';

    const o = document.createElement('div');
    o.id = '__app_error_overlay';
    o.setAttribute('role', 'dialog');
    o.style.position = 'fixed';
    o.style.inset = '0';
    o.style.display = 'flex';
    o.style.alignItems = 'center';
    o.style.justifyContent = 'center';
    o.style.zIndex = '9999';
    o.style.background = 'linear-gradient(180deg, rgba(2,1,43,0.95), rgba(2,1,43,0.98))';

    const card = document.createElement('div');
    card.style.maxWidth = '640px';
    card.style.width = 'min(92%, 720px)';
    card.style.padding = '28px';
    card.style.borderRadius = '16px';
    card.style.background = 'var(--card)';
    card.style.color = '#eef1fb';
    card.style.textAlign = 'center';
    card.style.boxShadow = '0 10px 40px rgba(2,3,10,0.7)';

    const h = document.createElement('div');
    h.style.fontWeight = '800';
    h.style.fontSize = '20px';
    h.style.marginBottom = '12px';
    h.textContent = title;

    const p = document.createElement('div');
    p.style.color = 'var(--muted)';
    p.style.marginBottom = '20px';
    p.textContent = message;

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-search';
    retryBtn.style.marginTop = '6px';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', async () => {
      removeOverlay();
      if (typeof onRetry === 'function') {
        try {
          await onRetry();
        } catch (e) {
          // show overlay again if retry fails
          showOverlay({ title, message, onRetry });
        }
      } else {
        location.reload();
      }
    });

    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(retryBtn);
    o.appendChild(card);
    document.body.appendChild(o);
    retryBtn.focus();
  }

  function showNoResultsOverlay() {
    showOverlay({
      title: 'No results found.',
      message: 'Sorry. Your search had no results. Refresh the page and try again.',
      onRetry: async () => {
        if (lastQuery) await window.searchCity(lastQuery);
        else location.reload();
      }
    });
  }

  function showErrorOverlay() {
    showOverlay({
      title: 'Something went wrong',
      message: "We couldn't connect to the API server. Try refreshing the page.",
      onRetry: async () => {
        if (lastCoords) {
          await _searchByCoordinates(lastCoords.lat, lastCoords.lon, lastPlaceLabel);
        } else if (lastQuery) {
          await window.searchCity(lastQuery);
        } else {
          location.reload();
        }
      }
    });
  }

  // --- helpers to show/hide suggestions and loading UI ---
  function showSuggestions(on = true) {
    if (!suggestions) return;
    suggestions.style.display = on ? 'block' : 'none';
  }

  function setLoadingState() {
    if (hero) hero.classList.add('loading');
    if (heroLoading) heroLoading.style.display = 'flex';
    if (heroResult) heroResult.style.display = 'none';
    if (noResults) noResults.style.display = 'none';
    if (errorBox) errorBox.style.display = 'none';
  }

  function showResultUI() {
    if (heroLoading) heroLoading.style.display = 'none';
    if (heroResult) heroResult.style.display = 'block';
    if (noResults) noResults.style.display = 'none';
    if (errorBox) errorBox.style.display = 'none';
    if (hero) hero.classList.remove('loading');
    removeOverlay();
  }

  // --- Unit selection logic (reads UI selection and maps to Open-Meteo params) ---
  function getSelectedUnits() {
    let temperature_unit = 'celsius';
    let wind_speed_unit = 'kmh';
    let precipitation_unit = 'mm';

    try {
      const tempSection = sections[1];
      const windSection = sections[2];
      const precipSection = sections[3];

      if (tempSection) {
        const s = tempSection.querySelector('button.selected');
        if (s) {
          const txt = s.textContent || s.innerText;
          if (/fahrenheit/i.test(txt)) temperature_unit = 'fahrenheit';
          else temperature_unit = 'celsius';
        }
      }
      if (windSection) {
        const s = windSection.querySelector('button.selected');
        if (s) {
          const txt = s.textContent || s.innerText;
          if (/mph/i.test(txt)) wind_speed_unit = 'mph';
          else wind_speed_unit = 'kmh';
        }
      }
      if (precipSection) {
        const s = precipSection.querySelector('button.selected');
        if (s) {
          const txt = s.textContent || s.innerText;
          if (/inch/i.test(txt)) precipitation_unit = 'inch';
          else precipitation_unit = 'mm';
        }
      }
    } catch (e) {
      // keep defaults
    }

    return { temperature_unit, wind_speed_unit, precipitation_unit };
  }

  const checkmarkPath = "./images/icon-checkmark.svg";
  function clearGroup(section) {
    section.querySelectorAll('button').forEach(b => {
      b.classList.remove('selected');
      const existing = b.querySelector('.checkmark');
      if (existing) existing.remove();
    });
  }
  function selectOption(btn, section) {
    if (!btn || !section) return;
    clearGroup(section);
    btn.classList.add('selected');
    if (!btn.querySelector('.checkmark')) {
      const img = document.createElement('img');
      img.src = checkmarkPath;
      img.alt = 'selected';
      img.className = 'checkmark';
      btn.appendChild(img);
    }
    if (!suppressUnitRefetch) applyUnitsChangeAndRefetch();
  }

  // attach click handlers to unit options (skip first section which is Switch)
  sections.forEach((section, idx) => {
    if (idx === 0) return;
    section.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        selectOption(b, section);
        if (dropdownMenu) dropdownMenu.classList.remove('show');
      });
    });
  });

  // initialize visual defaults (metric)
  if (sections[1] && sections[2] && sections[3]) {
    selectOption(sections[1].querySelectorAll('button')[0], sections[1]); // Celsius
    selectOption(sections[2].querySelectorAll('button')[0], sections[2]); // km/h
    selectOption(sections[3].querySelectorAll('button')[0], sections[3]); // mm
  }

  // Switch button behavior (metric <-> imperial)
  const switchSection = sections[0];
  const switchBtn = switchSection ? switchSection.querySelector('button') : null;
  if (switchBtn) {
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentlyPromptIsImperial = switchBtn.innerText.includes('Imperial');
      if (currentlyPromptIsImperial) {
        switchBtn.innerText = 'Switch to Metric';
        selectOption(sections[1].querySelectorAll('button')[1], sections[1]); // Fahrenheit
        selectOption(sections[2].querySelectorAll('button')[1], sections[2]); // mph
        selectOption(sections[3].querySelectorAll('button')[1], sections[3]); // Inches
      } else {
        switchBtn.innerText = 'Switch to Imperial';
        selectOption(sections[1].querySelectorAll('button')[0], sections[1]); // Celsius
        selectOption(sections[2].querySelectorAll('button')[0], sections[2]); // km/h
        selectOption(sections[3].querySelectorAll('button')[0], sections[3]); // mm
      }
      if (dropdownMenu) dropdownMenu.classList.remove('show');
    });
  }

  if (unitsBtn && dropdownMenu) {
    unitsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('show');
    });
    document.addEventListener('click', () => {
      dropdownMenu.classList.remove('show');
    });
  }

  // --- formatting helpers ---
  function formatDateReadable(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return isoString;
    }
  }

  function shortDayFromDate(dateStr) {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    } catch (e) {
      return dateStr;
    }
  }

  function formatHourFromIso(isoStr) {
    try {
      const parts = isoStr.split('T');
      if (parts.length < 2) return isoStr;
      const time = parts[1].slice(0, 5);
      const [hh] = time.split(':').map(Number);
      let h = hh % 12 || 12;
      const ampm = hh >= 12 ? 'PM' : 'AM';
      return `${h} ${ampm}`;
    } catch (e) {
      return isoStr;
    }
  }

  function weatherCodeToEmoji(code) {
    if (code === 0) return '☀️';
    if (code === 1 || code === 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code >= 45 && code <= 48) return '🌫️';
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 95) return '⛈️';
    return '🔆';
  }

  // --- Geocoding (Open-Meteo geocoding API) ---
  async function geocodePlace(query, maxResults = 6) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${maxResults}&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Geocoding failed');
    const data = await res.json();
    return data.results || [];
  }

  // --- Forecast fetch (Open-Meteo) ---
  async function fetchForecast(lat, lon, units) {
    const hourlyVars = [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'precipitation',
      'weathercode',
      'wind_speed_10m',
    ].join(',');

    const dailyVars = ['weathercode', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'].join(',');

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: hourlyVars,
      daily: dailyVars,
      timezone: 'auto',
      temperature_unit: units.temperature_unit,
      wind_speed_unit: units.wind_speed_unit,
      precipitation_unit: units.precipitation_unit,
      forecast_days: '7',
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Forecast failed');
    return await res.json();
  }

  // --- Rendering functions ---
  function renderCurrentAndStats(placeLabel, data, units) {
    try {
      const currentTime = (data && data.current_weather && data.current_weather.time) || (data.hourly && data.hourly.time && data.hourly.time[0]) || null;
      // pick a sensible index in hourly arrays
      let idx = 0;
      if (currentTime && data.hourly && Array.isArray(data.hourly.time)) {
        idx = data.hourly.time.indexOf(currentTime);
        if (idx === -1) idx = 0;
      }

      const currentTemp = (data && data.current_weather && data.current_weather.temperature) || (data.hourly && data.hourly.temperature_2m && data.hourly.temperature_2m[idx]);
      const feels = (data.hourly && data.hourly.apparent_temperature && data.hourly.apparent_temperature[idx] != null) ? data.hourly.apparent_temperature[idx] : null;
      const humidity = (data.hourly && data.hourly.relative_humidity_2m && data.hourly.relative_humidity_2m[idx] != null) ? data.hourly.relative_humidity_2m[idx] : null;
      const precip = (data.hourly && data.hourly.precipitation && data.hourly.precipitation[idx] != null) ? data.hourly.precipitation[idx] : null;
      const wind = (data.hourly && data.hourly.wind_speed_10m && data.hourly.wind_speed_10m[idx] != null) ? data.hourly.wind_speed_10m[idx] : (data.current_weather && data.current_weather.windspeed);

      if (cityNameEl) cityNameEl.textContent = placeLabel;
      if (cityDateEl) cityDateEl.textContent = currentTime ? formatDateReadable(currentTime) : (new Date()).toLocaleDateString();
      if (largeTemp) largeTemp.textContent = (currentTemp != null) ? `${Math.round(currentTemp)}°` : '—';
      if (iconLarge) iconLarge.style.display = 'none';

      if (valFeels) valFeels.textContent = feels != null ? `${Math.round(feels)}°` : '—';
      if (valHum) valHum.textContent = humidity != null ? `${Math.round(humidity)}%` : '—';

      const windUnitLabel = units.wind_speed_unit === 'mph' ? 'mph' : 'km/h';
      if (valWind) valWind.textContent = wind != null ? `${Math.round(wind)} ${windUnitLabel}` : '—';

      const precipUnitLabel = units.precipitation_unit === 'inch' ? 'in' : 'mm';
      if (valPrecip) valPrecip.textContent = precip != null ? `${Number(precip).toFixed(1)} ${precipUnitLabel}` : '—';
    } catch (e) {
      console.error('renderCurrentAndStats error', e);
    }
  }

  function renderHourlyList(data, units) {
    try {
      hourList.innerHTML = '';
      if (!data || !data.hourly || !Array.isArray(data.hourly.time)) return;
      const times = data.hourly.time;
      const temps = data.hourly.temperature_2m || [];
      const length = Math.min(times.length, 12);
      for (let i = 0; i < length; i++) {
        const t = document.createElement('div');
        t.className = 'hour';
        const timeDiv = document.createElement('div');
        timeDiv.className = 'time';
        timeDiv.textContent = formatHourFromIso(times[i]);
        const tempDiv = document.createElement('div');
        tempDiv.className = 't';
        tempDiv.textContent = (temps[i] != null) ? `${Math.round(temps[i])}°` : '—';
        t.appendChild(timeDiv);
        t.appendChild(tempDiv);
        hourList.appendChild(t);
      }
    } catch (e) {
      console.error('renderHourlyList error', e);
    }
  }

  function renderDailyCards(data) {
    try {
      const daily = data && data.daily;
      if (!daily || !Array.isArray(daily.time)) return;
      const days = daily.time;
      const max = Math.min(days.length, 5);
      dailyRow.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const card = document.createElement('div');
        card.className = 'day-card';
        const weekday = document.createElement('div');
        weekday.textContent = shortDayFromDate(days[i]);
        const iconDiv = document.createElement('div');
        iconDiv.style.fontSize = '26px';
        const code = (daily.weathercode && daily.weathercode[i] != null) ? daily.weathercode[i] : null;
        iconDiv.textContent = weatherCodeToEmoji(code);
        const miniTemp = document.createElement('div');
        miniTemp.className = 'mini-temp';
        const tmin = (daily.temperature_2m_min && daily.temperature_2m_min[i] != null) ? Math.round(daily.temperature_2m_min[i]) : '--';
        const tmax = (daily.temperature_2m_max && daily.temperature_2m_max[i] != null) ? Math.round(daily.temperature_2m_max[i]) : '--';
        miniTemp.textContent = `${tmax}° / ${tmin}°`;
        card.appendChild(weekday);
        card.appendChild(iconDiv);
        card.appendChild(miniTemp);
        dailyRow.appendChild(card);
      }
    } catch (e) {
      console.error('renderDailyCards error', e);
    }
  }

  // --- Debounced geocoding suggestions ---
  let suggestionsDebounce = null;
  if (input) {
    input.addEventListener('input', () => {
      if (suggestionsDebounce) clearTimeout(suggestionsDebounce);
      const q = input.value.trim();
      if (!q) {
        showSuggestions(false);
        return;
      }
      suggestionsDebounce = setTimeout(async () => {
        try {
          const results = await geocodePlace(q, 6);
          if (!results || results.length === 0) {
            suggestions.innerHTML = '<div class="item"><div>No suggestions</div></div>';
            showSuggestions(true);
            return;
          }
          suggestions.innerHTML = '';
          results.forEach(r => {
            const el = document.createElement('div');
            el.className = 'item';
            el.style.cursor = 'pointer';
            el.innerHTML = `
              <div style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.03)"></div>
              <div>
                <div style="font-weight:600">${r.name}${r.admin1 ? ', ' + r.admin1 : ''}</div>
                <div class="muted">${r.country}${r.latitude && r.longitude ? ` • ${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}` : ''}</div>
              </div>
            `;
            el.addEventListener('click', () => {
              input.value = `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}${r.country ? ', ' + r.country : ''}`;
              showSuggestions(false);
              _searchByCoordinates(r.latitude, r.longitude, `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}${r.country ? ', ' + r.country : ''}`);
            });
            suggestions.appendChild(el);
          });
          showSuggestions(true);
        } catch (e) {
          console.warn('suggestions error', e);
        }
      }, 350);
    });

    input.addEventListener('focus', () => showSuggestions(true));
    input.addEventListener('blur', () => setTimeout(() => showSuggestions(false), 160));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        window.searchCity && window.searchCity();
      }
    });
  }

  if (btn) btn.addEventListener('click', () => window.searchCity && window.searchCity());

  // --- Search function (geocode -> forecast) ---
  window.searchCity = async function (param) {
    let q = '';
    if (typeof param === 'string' && param.trim()) q = param.trim();
    else q = input ? input.value.trim() : '';

    if (!q) {
      input && input.focus();
      return;
    }

    lastQuery = q;
    lastCoords = null;
    lastPlaceLabel = null;

    showSuggestions(true);
    suggestions.innerHTML = `<div class="item">
      <div style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.03)"></div>
      <div>
        <div style="font-weight:600">Searching for "${escapeHtml(q)}"</div>
        <div class="muted">Search in progress</div>
      </div>
    </div>`;
    setLoadingState();

    try {
      const geos = await geocodePlace(q, 1);
      if (!geos || geos.length === 0) {
        showNoResultsOverlay();
        showSuggestions(false);
        if (hero) hero.classList.remove('loading');
        return;
      }
      const g = geos[0];
      lastCoords = { lat: g.latitude, lon: g.longitude };
      lastPlaceLabel = `${g.name}${g.admin1 ? ', ' + g.admin1 : ''}${g.country ? ', ' + g.country : ''}`;

      const units = getSelectedUnits();
      const data = await fetchForecast(g.latitude, g.longitude, units);
      if (!data) {
        showErrorOverlay();
        showSuggestions(false);
        return;
      }

      renderCurrentAndStats(lastPlaceLabel, data, units);
      renderHourlyList(data, units);
      renderDailyCards(data);
      showResultUI();
      showSuggestions(false);
      suppressUnitRefetch = false;
    } catch (e) {
      console.error('searchCity error', e);
      showErrorOverlay();
      showSuggestions(false);
      if (hero) hero.classList.remove('loading');
    }
  };

  // search directly by coordinates (used by suggestions and initial load)
  async function _searchByCoordinates(lat, lon, placeLabel) {
    lastCoords = { lat, lon };
    lastPlaceLabel = placeLabel || `${lat}, ${lon}`;
    lastQuery = null;

    setLoadingState();
    try {
      const units = getSelectedUnits();
      const data = await fetchForecast(lat, lon, units);
      renderCurrentAndStats(lastPlaceLabel, data, units);
      renderHourlyList(data, units);
      renderDailyCards(data);
      showResultUI();
      suppressUnitRefetch = false;
    } catch (e) {
      console.error('_searchByCoordinates error', e);
      showErrorOverlay();
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  // when units change, refetch the current shown place (if any)
  async function applyUnitsChangeAndRefetch() {
    removeOverlay();
    try {
      if (lastCoords) {
        await _searchByCoordinates(lastCoords.lat, lastCoords.lon, lastPlaceLabel);
      } else if (lastQuery) {
        await window.searchCity(lastQuery);
      }
    } catch (e) {
      console.error('applyUnitsChangeAndRefetch error', e);
      showErrorOverlay();
    }
  }

  // initial visual default already set above; attach the Switch toggle to action
  // (Switch code added previously handles visual toggling)

  // --- Initial load: set input and fetch Natal directly by coords ---
  window.addEventListener('DOMContentLoaded', () => {
    if (input) input.value = DEFAULT_CITY;
    // perform direct coordinate fetch for Natal so we avoid geocoding issues
    lastCoords = DEFAULT_COORDS;
    lastPlaceLabel = DEFAULT_CITY;
    // allow unit changes to trigger refetch after first load
    suppressUnitRefetch = false;
    _searchByCoordinates(DEFAULT_COORDS.lat, DEFAULT_COORDS.lon, DEFAULT_CITY).catch(e => {
      console.error('initial load error', e);
      showErrorOverlay();
    });
  });

})();


