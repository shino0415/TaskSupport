const POSITIVE_INTEGER_PATTERN = /^\d+$/

/** URLパラメータのidを正の整数として解釈する。`0`・負数・小数・指数表記・16進表記などはnull。 */
export function parsePositiveIntegerParam(value: string | undefined): number | null {
  if (value === undefined || !POSITIVE_INTEGER_PATTERN.test(value)) {
    return null
  }
  const id = Number(value)
  return id >= 1 ? id : null
}
