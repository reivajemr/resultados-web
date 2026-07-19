<template>
  <div class="inh-panel">
    <div v-if="!hasData" class="empty">
      {{ data?.lastPoll ? 'No hay carreras hoy' : 'Consultando programación...' }}
    </div>

    <template v-if="hasData">
      <div v-for="track in trackNames" :key="track" class="track-section">
        <h3 class="track-name">{{ track }} <span class="track-date">{{ trackDate(track) }}</span></h3>

        <!-- Resultados (carreras cerradas) -->
        <div v-if="closedRaces[track]?.length" class="subsection">
          <h4 class="subsection-title">Resultados</h4>
          <div v-for="race in closedRaces[track]" :key="race.raceNumber" class="race-card closed">
            <div class="race-header">
              <span class="race-number">C{{ race.raceNumber }}</span>
              <span class="race-time">{{ race.raceTime || '—' }}</span>
              <span class="race-status closed">Cerrada</span>
            </div>

            <!-- Tabla de posiciones -->
            <table class="result-table" v-if="race.horses?.some(h => h.position)">
              <thead>
                <tr><th>Pos</th><th>No</th><th>Ejemplar</th><th>Ganador</th><th>Place</th></tr>
              </thead>
              <tbody>
                <tr v-for="h in sortedHorses(race)" :key="h.programNumber"
                    :class="{ winner: h.position === 1, placed: h.position === 2 || h.position === 3, scratched: h.isScratched }">
                  <td class="pos">{{ h.position ? h.position + '°' : '—' }}</td>
                  <td class="num">{{ h.programNumber }}</td>
                  <td class="name">{{ h.horseName }}<span v-if="h.isScratched" class="retirado-badge">R</span></td>
                  <td class="div">{{ h.ganadorDividend || '—' }}</td>
                  <td class="div">{{ h.placeDividend || '—' }}</td>
                </tr>
              </tbody>
            </table>

            <!-- Dividendos exóticos -->
            <div v-if="race.dividends && Object.keys(race.dividends).length" class="exotic-divs">
              <span v-for="(val, key) in race.dividends" :key="key" class="exotic-item">
                <span class="exo-label">{{ key }}</span>
                <span class="exo-value">{{ val }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Programa (carreras abiertas) -->
        <div v-if="openRaces[track]?.length" class="subsection">
          <h4 class="subsection-title">Programa</h4>
          <div v-for="race in openRaces[track]" :key="race.raceNumber" class="race-card open">
            <div class="race-header">
              <span class="race-number">C{{ race.raceNumber }}</span>
              <span class="race-time">{{ race.raceTime || '—' }}</span>
              <span class="race-status open">Abierta</span>
            </div>
            <table class="horse-table">
              <thead>
                <tr><th>No</th><th>Div.</th><th>Ejemplar</th><th>Kg</th></tr>
              </thead>
              <tbody>
                <tr v-for="h in race.horses" :key="h.programNumber" :class="{ scratched: h.isScratched }">
                  <td class="num">{{ h.programNumber }}</td>
                  <td class="div">{{ h.dividend || '—' }}</td>
                  <td class="name">{{ h.horseName }}<span v-if="h.isScratched" class="retirado-badge">R</span></td>
                  <td class="kg">{{ h.weight || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ data: Object })

const hasData = computed(() => props.data?.races?.length)

const trackNames = computed(() => {
  if (!props.data?.races) return []
  return [...new Set(props.data.races.map(r => r.track))]
})

function racesByStatus(track, isClosed) {
  return (props.data?.races || []).filter(r =>
    r.track === track && (isClosed ? r.statusText === 'CERRADA' : r.statusText !== 'CERRADA')
  )
}

const closedRaces = computed(() => {
  const map = {}
  for (const t of trackNames.value) {
    map[t] = racesByStatus(t, true)
  }
  return map
})

const openRaces = computed(() => {
  const map = {}
  for (const t of trackNames.value) {
    map[t] = racesByStatus(t, false)
  }
  return map
})

function trackDate(track) {
  const race = (props.data?.races || []).find(r => r.track === track && r.raceDate)
  return race?.raceDate || ''
}

function sortedHorses(race) {
  if (!race.horses) return []
  return [...race.horses].sort((a, b) => {
    if (a.position && b.position) return a.position - b.position
    if (a.position) return -1
    if (b.position) return 1
    return parseInt(a.programNumber) - parseInt(b.programNumber)
  })
}
</script>

<style scoped>
.empty { color: #888; font-style: italic; padding: 12px 0; }
.track-section { margin-bottom: 24px; }
.track-name { font-size: 1.1rem; font-weight: 700; color: #1a1a2e; margin-bottom: 12px; border-left: 4px solid #1a1a2e; padding-left: 10px; display: flex; align-items: center; gap: 8px; }
.track-date { font-size: 0.75rem; font-weight: 400; color: #888; }
.subsection { margin-bottom: 16px; }
.subsection-title { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 8px; }
.race-card { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
.race-card.closed { border-color: #9e9e9e; }
.race-card.open { border-color: #4caf50; }
.race-header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #f5f5f5; font-size: 0.9rem; }
.race-number { font-weight: 700; min-width: 30px; }
.race-time { color: #666; font-size: 0.8rem; }
.race-status { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.race-status.closed { background: #e0e0e0; color: #555; }
.race-status.open { background: #e8f5e9; color: #2e7d32; }
table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
th { background: #fafafa; padding: 6px 8px; text-align: left; font-weight: 600; color: #555; border-bottom: 1px solid #e0e0e0; }
td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
tr.winner { background: #fff8e1; font-weight: 600; }
tr.placed { background: #f5f5f5; }
tr.scratched { opacity: 0.5; text-decoration: line-through; }
.retirado-badge { display: inline-block; background: #d32f2f; color: #fff; font-size: 0.6rem; font-weight: 700; padding: 0 4px; border-radius: 3px; margin-left: 4px; vertical-align: middle; line-height: 1.4; }
.pos { font-weight: 700; color: #1a1a2e; width: 30px; }
.num { font-weight: 600; width: 28px; color: #333; }
.name { flex: 1; }
.div { font-family: monospace; text-align: right; color: #2e7d32; font-weight: 600; }
.kg { text-align: center; color: #666; }
.exotic-divs { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; background: #fafafa; border-top: 1px solid #e0e0e0; }
.exotic-item { background: #fff; border: 1px solid #e8e8e8; border-radius: 4px; padding: 3px 8px; font-size: 0.75rem; display: flex; gap: 6px; }
.exo-label { color: #666; }
.exo-value { font-weight: 700; color: #2e7d32; font-family: monospace; }
</style>
