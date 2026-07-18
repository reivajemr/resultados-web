<template>
  <div class="inh-panel">
    <div v-if="!tracks.length && !racesList.length" class="empty">
      {{ data?.lastPoll ? 'No hay carreras hoy' : 'Consultando programación...' }}
    </div>

    <div v-for="track in tracks" :key="track.name" class="track-section">
      <h3 class="track-name">{{ track.name }}</h3>
      <div class="race-list">
        <div v-for="race in track.races" :key="race.raceNumber" class="race-card" :class="statusClass(race.statusText)">
          <div class="race-header">
            <span class="race-number">Carrera {{ race.raceNumber }}</span>
            <span class="race-time">{{ race.raceTime || '—' }}</span>
            <span class="race-status" :class="statusClass(race.statusText)">{{ statusLabel(race.statusText) }}</span>
          </div>

          <div v-if="raceDetails[race.raceNumber]" class="race-body">
            <div v-if="raceDetails[race.raceNumber].horses?.length" class="horses">
              <div v-for="h in raceDetails[race.raceNumber].horses" :key="h.programNumber" class="horse-row" :class="{ scratched: h.isScratched }">
                <span class="horse-num">#{{ h.programNumber }}</span>
                <span class="horse-name">{{ h.horseName }}</span>
                <span v-if="h.position" class="horse-pos">{{ h.position }}°</span>
                <span v-if="h.isScratched" class="horse-status-badge">RETIRADO</span>
              </div>
            </div>

            <div v-if="raceDetails[race.raceNumber].dividends && Object.keys(raceDetails[race.raceNumber].dividends).length" class="dividends">
              <h4>Dividendos</h4>
              <div v-for="(val, key) in raceDetails[race.raceNumber].dividends" :key="key" class="div-item">
                <span class="div-label">{{ key }}</span>
                <span class="div-value">{{ val }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!tracks.length && racesList.length" class="race-list">
      <div v-for="race in racesList" :key="race.raceNumber" class="race-card" :class="statusClass(race.statusText)">
        <div class="race-header">
          <span class="race-number">Carrera {{ race.raceNumber }}</span>
          <span class="race-status" :class="statusClass(race.statusText)">{{ statusLabel(race.statusText) }}</span>
        </div>
        <div class="race-body">
          <div v-if="race.horses?.length" class="horses">
            <div v-for="h in race.horses" :key="h.programNumber" class="horse-row" :class="{ scratched: h.isScratched }">
              <span class="horse-num">#{{ h.programNumber }}</span>
              <span class="horse-name">{{ h.horseName }}</span>
              <span v-if="h.position" class="horse-pos">{{ h.position }}°</span>
              <span v-if="h.isScratched" class="horse-status-badge">RETIRADO</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  data: Object
})

const tracks = computed(() => {
  if (!props.data?.program?.length) return []
  const map = {}
  for (const race of props.data.program) {
    if (!map[race.track]) map[race.track] = []
    map[race.track].push(race)
  }
  return Object.entries(map).map(([name, races]) => ({ name, races }))
})

const racesList = computed(() => props.data?.races || [])

const raceDetails = computed(() => {
  const map = {}
  if (props.data?.races) {
    for (const r of props.data.races) {
      map[r.raceNumber] = r
    }
  }
  return map
})

function statusClass(s) {
  if (!s) return 'status-pending'
  if (s.includes('ABIERTA')) return 'status-open'
  if (s.includes('CERRADA')) return 'status-closed'
  return 'status-pending'
}

function statusLabel(s) {
  if (!s) return 'Programada'
  if (s.includes('ABIERTA')) return 'Abierta'
  if (s.includes('CERRADA')) return 'Cerrada'
  return s
}
</script>

<style scoped>
.empty { color: #888; font-style: italic; padding: 12px 0; }
.track-section { margin-bottom: 20px; }
.track-name { font-size: 1rem; color: #1a1a2e; margin-bottom: 8px; padding-left: 4px; border-left: 3px solid #1a1a2e; padding-left: 10px; }
.race-list { display: flex; flex-direction: column; gap: 10px; }
.race-card { border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.race-card.status-open { border-color: #4caf50; }
.race-card.status-closed { border-color: #9e9e9e; opacity: 0.85; }
.race-header { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: #fafafa; border-bottom: 1px solid #eee; }
.race-number { font-weight: 600; font-size: 0.9rem; }
.race-time { color: #666; font-size: 0.85rem; }
.race-status { font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
.race-status.status-open { background: #e8f5e9; color: #2e7d32; }
.race-status.status-closed { background: #eeeeee; color: #616161; }
.race-status.status-pending { background: #fff3e0; color: #e65100; }
.race-body { padding: 8px 12px; }
.horses { display: flex; flex-direction: column; gap: 4px; }
.horse-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 0.85rem; }
.horse-row.scratched { opacity: 0.5; text-decoration: line-through; }
.horse-num { font-weight: 600; min-width: 28px; color: #555; }
.horse-name { flex: 1; }
.horse-pos { background: #1a1a2e; color: #fff; padding: 1px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
.horse-status-badge { background: #ef5350; color: #fff; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
.dividends { margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee; }
.dividends h4 { font-size: 0.8rem; color: #666; margin-bottom: 4px; }
.div-item { display: flex; justify-content: space-between; font-size: 0.8rem; padding: 2px 0; }
.div-label { color: #555; }
.div-value { font-weight: 600; color: #2e7d32; }
</style>
