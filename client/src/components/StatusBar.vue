<template>
  <div class="status-bar">
    <span class="status-dot" :class="{ loading }"></span>
    <span v-if="lastUpdate">Última actualización: {{ timeAgo }}</span>
    <span v-else>Esperando datos...</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  lastUpdate: Date,
  loading: Boolean
})

const timeAgo = computed(() => {
  if (!props.lastUpdate) return 'nunca'
  const diff = Math.floor((Date.now() - props.lastUpdate.getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  return `${Math.floor(diff / 60)}m ${diff % 60}s`
})
</script>

<style scoped>
.status-bar { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #666; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; display: inline-block; }
.status-dot.loading { background: #ff9800; animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
