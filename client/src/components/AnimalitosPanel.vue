<template>
  <div class="game-card">
    <h3 class="game-title">{{ title }}</h3>
    <table class="draw-table">
      <thead>
        <tr>
          <th>Hora</th>
          <th>Resultado</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="draw in draws" :key="draw.time" class="draw-row" :class="statusClass(draw.status)">
          <td class="draw-time">{{ draw.time }}</td>
          <td class="draw-result" :style="resultColor(draw)">
            {{ resultLabel(draw) }}
          </td>
          <td class="draw-status">{{ statusLabel(draw.status) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
const props = defineProps({
  game: Object
})

const title = props.game?.name || 'Resultados'
const draws = props.game?.draws || []

function statusClass(s) {
  if (s === 'completed') return 'row-done'
  if (s === 'failed') return 'row-fail'
  return 'row-pending'
}

function statusLabel(s) {
  if (s === 'completed') return '✓'
  if (s === 'failed') return '✗'
  return '—'
}

function resultLabel(draw) {
  if (draw.status === 'completed' && draw.result) {
    if (draw.result.animal) {
      return `${draw.result.number} - ${draw.result.animal}`
    }
    return `#${draw.result.number}`
  }
  return ''
}

function resultColor(draw) {
  if (draw.result?.color === 'red') return 'color: #d32f2f'
  if (draw.result?.color === 'green') return 'color: #2e7d32'
  return ''
}
</script>

<style scoped>
.game-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.game-title { font-size: 0.95rem; color: #1a1a2e; padding: 10px 12px; background: #fafafa; border-bottom: 1px solid #eee; }
.draw-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.draw-table th { text-align: left; padding: 6px 12px; background: #f5f5f5; color: #666; font-weight: 500; font-size: 0.75rem; text-transform: uppercase; }
.draw-table td { padding: 6px 12px; border-top: 1px solid #f0f0f0; }
.draw-time { color: #555; font-weight: 500; }
.draw-result { font-weight: 600; }
.draw-status { text-align: center; }
.row-done .draw-status { color: #4caf50; }
.row-fail .draw-status { color: #ef5350; }
.row-pending .draw-status { color: #bdbdbd; }
.row-fail .draw-result { color: #999 !important; font-style: italic; }
.row-pending .draw-result { color: #bdbdbd; }
</style>
