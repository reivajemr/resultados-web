<template>
  <div class="app">
    <header class="header">
      <h1>Resultados</h1>
      <StatusBar :lastUpdate="lastUpdate" :loading="loading" />
      <button class="btn-refresh" @click="refresh" :disabled="loading">
        {{ loading ? 'Actualizando...' : 'Actualizar' }}
      </button>
    </header>

    <section class="section">
      <h2>Carreras de Caballos (INH)</h2>
      <INHPanel :data="inh" />
    </section>

    <section class="section">
      <div class="animalitos-header">
        <h2>Animalitos</h2>
        <div class="date-nav">
          <button class="btn-nav" @click="prevDay(); refresh()" :disabled="loading">&larr;</button>
          <span class="date-label">{{ selectedDate }}</span>
          <button class="btn-nav" @click="nextDay(); refresh()" :disabled="loading || !isHistorical">&rarr;</button>
          <button v-if="isHistorical" class="btn-today" @click="goToday(); refresh()">Hoy</button>
        </div>
        <div class="debug-url" v-if="debugUrl">{{ debugUrl }}</div>
      </div>
      <div class="animalitos-actions">
        <button v-if="isHistorical" class="btn-fetch" @click="fetchDate" :disabled="fetching">
          {{ fetching ? 'Cargando...' : `Cargar resultados de ${selectedDate}` }}
        </button>
      </div>
      <div class="animalitos-grid">
        <AnimalitosPanel v-for="game in animalitos" :key="game.id" :game="game" />
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from './composables/useApi.js'
import INHPanel from './components/INHPanel.vue'
import AnimalitosPanel from './components/AnimalitosPanel.vue'
import StatusBar from './components/StatusBar.vue'

const { inh, animalitos, loading, selectedDate, isHistorical, debugUrl, fetchAll, goToDate, goToday, prevDay, nextDay } = useApi()
const lastUpdate = ref(null)
const fetching = ref(false)

async function refresh() {
  await fetchAll()
  lastUpdate.value = new Date()
}

async function fetchDate() {
  fetching.value = true
  try {
    const res = await fetch(`/api/animalitos/refetch?fecha=${selectedDate.value}`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await refresh()
  } catch (e) {
    console.error('Error fetching date:', e.message)
  } finally {
    fetching.value = false
  }
}

onMounted(() => {
  refresh()
  setInterval(() => {
    if (!isHistorical.value) refresh()
  }, 60 * 1000)
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
.app { max-width: 1200px; margin: 0 auto; padding: 16px; }
.header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.header h1 { font-size: 1.5rem; color: #1a1a2e; }
.btn-refresh { padding: 6px 16px; background: #1a1a2e; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
.btn-refresh:disabled { opacity: 0.6; cursor: not-allowed; }
.section { background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.section h2 { font-size: 1.15rem; color: #1a1a2e; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #eee; }
.animalitos-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #eee; flex-wrap: wrap; gap: 8px; }
.animalitos-header h2 { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
.date-nav { display: flex; align-items: center; gap: 6px; }
.btn-nav { padding: 4px 10px; background: #1a1a2e; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
.btn-nav:disabled { opacity: 0.4; cursor: not-allowed; }
.date-input { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.85rem; }
.date-label { font-size: 0.95rem; font-weight: 600; color: #1a1a2e; min-width: 100px; text-align: center; }
.btn-today { padding: 4px 12px; background: #e8eaf6; color: #1a1a2e; border: 1px solid #c5cae9; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
.debug-url { font-size: 0.75rem; color: #999; margin-bottom: 8px; font-family: monospace; }
.animalitos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px; }
.animalitos-actions { margin-bottom: 12px; }
.btn-fetch { padding: 6px 16px; background: #2e7d32; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
.btn-fetch:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
