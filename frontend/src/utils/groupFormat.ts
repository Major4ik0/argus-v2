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
    if (groups.length >= 3) {
      // 3 или более групп с одного курса -> поток
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
      // 1 или 2 группы -> остаются как есть (перечисляются через запятую)
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

/**
 * Форматирует плашку учебных групп в карточке занятия:
 * - 0 групп: "—"
 * - 1 группа: "1391"
 * - 2 группы: "1391, 1392"
 * - 3 и более групп (поток): "Поток (3 гр.)"
 */
export function renderGroupBadge(groupsInput?: string[] | string | null): string {
  const groupList = Array.isArray(groupsInput)
    ? groupsInput.flatMap((g) => (g ? String(g).split(',').map((s) => s.trim()) : [])).filter(Boolean)
    : typeof groupsInput === 'string'
      ? groupsInput.split(',').map((g) => g.trim()).filter(Boolean)
      : []

  const uniqueGroups = Array.from(new Set(groupList))
  if (uniqueGroups.length === 0) return '—'
  if (uniqueGroups.length >= 3) {
    return `Поток (${uniqueGroups.length} гр.)`
  }
  return uniqueGroups.join(', ')
}

