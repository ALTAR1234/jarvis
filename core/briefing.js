// Daily briefing: local weather (Open-Meteo, no key), top headlines (Gemini + Google Search), today's
// reminders and anything notable about the PC, composed into a short spoken greeting.
const store = require('./store');
const osx = require('./os');

const WMO = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow',
  77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'severe thunderstorms' };
const ICON = (code) => (code === 0 || code === 1 ? '☀' : code <= 3 ? '⛅' : code <= 48 ? '🌫' : code >= 95 ? '⛈' : code >= 71 && code <= 86 && ![80, 81, 82].includes(code) ? '❄' : '🌧');
const IMPERIAL = new Set(['US', 'LR', 'MM']);
const geoCache = new Map();
let cache = null;

async function getJson(url, timeoutMs = 12000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Weather service returned ${r.status}.`);
  return r.json();
}

async function weather(city) {
  const name = String(city || '').trim();
  if (!name) return null;
  let place = geoCache.get(name.toLowerCase());
  if (!place) {
    // Open-Meteo matches city names only, so "Dallas, TX" is looked up as "Dallas" and the rest picks the best match.
    const [first, ...rest] = name.split(',').map((s) => s.trim());
    const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(first)}&count=10&language=en`);
    const hint = rest.join(' ').toLowerCase();
    const results = geo.results || [];
    place = results.find((p) => hint && [p.admin1, p.country, p.country_code].some((v) => v && (v.toLowerCase() === hint || v.toLowerCase().startsWith(hint)))) || results[0];
    if (!place) throw new Error(`Could not find a place called "${name}".`);
    geoCache.set(name.toLowerCase(), place);
  }
  const imperial = IMPERIAL.has(place.country_code);
  const f = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=1${imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : ''}`);
  const c = f.current || {}, d = f.daily || {};
  return {
    place: [place.name, place.admin1 && place.admin1 !== place.name ? place.admin1 : null].filter(Boolean).join(', '),
    unit: imperial ? '°F' : '°C', windUnit: imperial ? 'mph' : 'km/h',
    temp: Math.round(c.temperature_2m), feelsLike: Math.round(c.apparent_temperature), condition: WMO[c.weather_code] || 'unknown', icon: ICON(c.weather_code),
    humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m),
    high: Math.round(d.temperature_2m_max?.[0]), low: Math.round(d.temperature_2m_min?.[0]), rainChance: d.precipitation_probability_max?.[0], todayCondition: WMO[d.weather_code?.[0]] || null
  };
}

function parseJson(text) {
  // Search-grounded replies can't use JSON mode, so take the outermost {...} from the text.
  const body = String(text || '');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

let inflight = null;
function build(opts) {
  const key = JSON.stringify(opts.profile);
  if (!opts.fresh && cache && Date.now() - cache.at < 30 * 60 * 1000 && cache.key === key) return Promise.resolve(cache.value);
  if (!opts.fresh && inflight?.key === key) return inflight.promise;
  const promise = compose(opts).finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { key, promise };
  return promise;
}
async function compose({ generate, profile, timeZone }) {
  const [wx, stats] = await Promise.all([weather(profile.homeCity).catch((e) => ({ error: e.message })), osx.stats().catch(() => null)]);
  const zone = typeof timeZone === 'string' && /^[A-Za-z_+\-/0-9]{1,64}$/.test(timeZone) ? timeZone : undefined;
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: zone });
  const reminders = store.reminders().filter((r) => new Date(r.due).toLocaleDateString('en-CA', { timeZone: zone }) === today)
    .map((r) => `${new Date(r.due).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })}: ${r.text}`);
  const facts = store.memories().slice(-40).map((m) => `- ${m.text}`).join('\n');
  const notes = [];
  if (stats?.battery && !stats.battery.none && stats.battery.percent <= 25 && !stats.battery.charging) notes.push(`battery is at ${stats.battery.percent}% and not charging`);
  if (stats?.disk && stats.disk.freeGB < 20) notes.push(`only ${stats.disk.freeGB} GB of disk space left`);
  if (stats?.memory && stats.memory.usedGB / stats.memory.totalGB > 0.9) notes.push('memory usage is above 90%');

  const prompt = `You are J.A.R.V.I.S. preparing the user's briefing. It is ${now.toLocaleString('en-US', { timeZone: zone, dateStyle: 'full', timeStyle: 'short' })}${zone ? ` (${zone})` : ''}.
Use Google Search to find the 5 most important news headlines from the last 24 hours${profile.newsTopics ? `, focused on: ${profile.newsTopics}` : `: two world or national stories, one business or markets story, one technology story${wx && !wx.error && wx.place ? `, and one local story for ${wx.place}` : ', and one more major story'}`}. Only use real, current headlines you found; never invent news.

Data:
- User's name: ${profile.userName || 'unknown (check the facts below; otherwise address them as "sir")'}
- Weather: ${wx && !wx.error ? JSON.stringify(wx) : wx?.error ? `unavailable (${wx.error})` : 'no home city set'}
- Reminders today: ${reminders.length ? reminders.join('; ') : 'none'}
- PC notes: ${notes.length ? notes.join('; ') : 'nothing notable'}
${facts ? `- Known facts about the user:\n${facts}` : ''}

Reply with only a JSON object, no other text:
{"speech": "...", "news_speech": "...", "headlines": [{"headline": "...", "source": "...", "summary": "..."}]}
"speech" is what J.A.R.V.I.S. says aloud: greet the user by name for the time of day in a composed, lightly witty British butler tone, give the weather in one sentence, then the top three headlines in one short sentence each, mention today's reminders and any PC notes, and end by offering help. Plain sentences only, no lists, markdown or URLs, about 90-130 words.${!profile.homeCity ? ' Also mention once that they can set a home city in Settings for local weather.' : ''}
"news_speech" is the same briefing without the greeting and weather: it starts directly with the headlines (e.g. "Here is what is happening today."), then reminders, PC notes and the offer of help, about 70-100 words.
"headlines" has the 5 headlines; "headline" under 90 characters, "source" is the publication name, "summary" is one sentence.`;

  const text = await generate(prompt);
  const parsed = parseJson(text);
  if (!parsed?.speech) throw new Error('Gemini did not return a briefing. Try again in a moment.');
  const value = {
    speech: String(parsed.speech).trim(), newsSpeech: String(parsed.news_speech || parsed.speech).trim(),
    headlines: (Array.isArray(parsed.headlines) ? parsed.headlines : []).filter((h) => h?.headline).slice(0, 6)
      .map((h) => ({ headline: String(h.headline).slice(0, 140), source: String(h.source || '').slice(0, 60), summary: String(h.summary || '').slice(0, 300) })),
    weather: wx && !wx.error ? wx : null, weatherError: wx?.error || null, reminders, generatedAt: new Date().toISOString()
  };
  cache = { at: Date.now(), key: JSON.stringify(profile), value };
  return value;
}

module.exports = { build, weather };
