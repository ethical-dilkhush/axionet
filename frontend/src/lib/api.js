/** Ensure a value is always returned as an array. */
export const asArray = (val) =>
  Array.isArray(val) ? val : val ? [val] : []
