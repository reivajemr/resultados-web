import { ref } from 'vue'

export function useApi() {
  const inh = ref({ program: [], races: [], isRunning: false, lastPoll: null })
  const animalitos = ref([])
  const loading = ref(false)
  const error = ref(null)
  const selectedDate = ref(new Date().toISOString().split('T')[0])
  const isHistorical = ref(false)
  const debugUrl = ref('')

  function todayStr() {
    return new Date().toISOString().split('T')[0]
  }

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
      loading.value = true
      const url = selectedDate.value === todayStr()
        ? '/api/animalitos'
        : `/api/animalitos/historial?fecha=${selectedDate.value}`
      debugUrl.value = url
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      animalitos.value = data.games || []
    } catch (e) {
      console.error('Error fetching animalitos:', e.message)
    } finally {
      loading.value = false
    }
  }

  async function fetchAll() {
    error.value = null
    await Promise.all([fetchINH(), fetchAnimalitos()])
  }

  function goToDate(date) {
    selectedDate.value = date
    isHistorical.value = date !== todayStr()
  }

  function goToday() {
    goToDate(todayStr())
  }

  function prevDay() {
    const d = new Date(selectedDate.value)
    d.setDate(d.getDate() - 1)
    goToDate(d.toISOString().split('T')[0])
  }

  function nextDay() {
    const d = new Date(selectedDate.value)
    d.setDate(d.getDate() + 1)
    const today = todayStr()
    if (d.toISOString().split('T')[0] > today) return
    goToDate(d.toISOString().split('T')[0])
  }

  return { inh, animalitos, loading, error, selectedDate, isHistorical, debugUrl, fetchAll, goToDate, goToday, prevDay, nextDay }
}
