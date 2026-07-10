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
      <h2>Animalitos</h2>
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

const { inh, animalitos, loading, fetchAll } = useApi()
const lastUpdate = ref(null)

async function refresh() {
  await fetchAll()
  lastUpdate.value = new Date()
}

onMounted(() => {
  refresh()
  setInterval(refresh, 60 * 1000)
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
.animalitos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px; }
</style>
