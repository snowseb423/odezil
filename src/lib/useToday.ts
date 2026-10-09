import { useEffect, useState } from 'react'
import { msUntilNextMidnight, todayIn } from '../domain/dates.ts'
import type { IsoDate } from '../domain/types.ts'

/** Date du jour à Maurice, mise à jour à minuit et au retour au premier plan. */
export function useToday(): IsoDate {
  const [today, setToday] = useState(() => todayIn())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        setToday(todayIn())
        schedule()
      }, msUntilNextMidnight() + 1_000)
    }
    schedule()
    const onVisible = () => {
      if (document.visibilityState === 'visible') setToday(todayIn())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return today
}
