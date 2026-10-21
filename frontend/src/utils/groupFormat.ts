/**
 * Утилита форматирования учебных групп в потоки.
 * Формат академической группы: ровно 4 цифры (например, "1190").
 * - 1-я цифра: факультет (1 или 2, всего 2 факультета: 1 - АСУ, 2 - РЭС).
 * - 2-я цифра: номер курса (1..5, всего 5 курсов).
 * - 3-я и 4-я цифры: кафедра/специализация (до 6 видов групп с одного курса).
 * Любые группы, не подходящие под этот формат, остаются в исходном виде.
 * 
 * Если выбрано >= 2 групп с одного курса одного факультета (совпадают первые 2 цифры),
 * они объединяются в "{факультет}{курс}-поток" (например, 1180 и 1190 -> "11-поток").
 */

export interface StreamBadgeInfo {
  streamName: string
  faculty: number
  course: number
  prefix: string
  groups: string[]
}

export interface GroupStreamFormattingResult {
  formattedText: string
  streamBadges: StreamBadgeInfo[]
  individualGroups: string[]
}

export function formatGroupStreams(groupNames: string[]): GroupStreamFormattingResult {
  const standardPattern = /^([1-2])([1-5])\d{2}$/

  // Карта префиксов: "11" -> ["1180", "1190"]
  const prefixMap = new Map<string, string[]>()
  const nonStandard: string[] = []

  for (const rawName of groupNames) {
    const name = (rawName || '').trim()
    if (!name) continue

    const match = name.match(standardPattern)
    if (match) {
      const prefix = `${match[1]}${match[2]}`
      if (!prefixMap.has(prefix)) {
        prefixMap.set(prefix, [])
      }
      prefixMap.get(prefix)!.push(name)
    } else {
      nonStandard.push(name)
    }
  }

  const streamBadges: StreamBadgeInfo[] = []
  const individualGroups: string[] = []
  const resultParts: string[] = []

  // Сортируем префиксы для детерминированного вывода
  const sortedPrefixes = Array.from(prefixMap.keys()).sort()

  for (const prefix of sortedPrefixes) {
    const groups = prefixMap.get(prefix)!
    if (groups.length >= 2) {
      // 2 или более групп с одного курса -> поток
      const streamName = `${prefix}-поток`
      streamBadges.push({
        streamName,
        faculty: Number(prefix[0]),
        course: Number(prefix[1]),
        prefix,
        groups: [...groups].sort(),
      })
      resultParts.push(streamName)
    } else {
      // Только 1 группа -> остается как есть
      individualGroups.push(...groups)
      resultParts.push(...groups)
    }
  }

  // Добавляем нестандартные группы
  individualGroups.push(...nonStandard)
  resultParts.push(...nonStandard)

  return {
    formattedText: resultParts.join(', '),
    streamBadges,
    individualGroups,
  }
}
