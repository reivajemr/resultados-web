import { ref } from 'vue'

export function useApi() {
  const inh = ref({ program: [], races: [], isRunning: false, lastPoll: null })
  const animalitos = ref([])
  const loading = ref(false)
  const error = ref(null)

  async function fetchINH() {
    try {
      const res = await fetch('/api/inh')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      inh.value = await res.json()
    } catch (e) {
      console.error('Error fetching INH:', e.message)
    }
  }

  async function fetchAnimalitos() {
    try {
      const res = await fetch('/api/animalitos')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      animalitos.value = data.games || []
    } catch (e) {
      console.error('Error fetching animalitos:', e.message)
    }
  }

  async function fetchAll() {
    loading.value = true
    error.value = null
    await Promise.all([fetchINH(), fetchAnimalitos()])
    loading.value = false
  }

  return { inh, animalitos, loading, error, fetchAll }
}
