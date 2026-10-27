/** High-confidence general requests bypass planning even when spreadsheets exist.
 * Ambiguous requests still reach the planner, which can choose narrative/RAG.
 * Never evaluate arbitrary user code or interpret a spreadsheet value as code.
 */
export function isGeneralRequest(question: string) {
  const q = question.trim();
  if (
    /^(?:(?:quanto (?:fa|fanno)|what is|calculate|calcola)\s+)?[+-]?\d+(?:[.,]\d+)?\s*[+*/×÷-]\s*[+-]?\d+(?:[.,]\d+)?\s*[?=.!]*$/i.test(
      q,
    )
  )
    return true;
  return /^(?:ciao|salve|buongiorno|hello|hi|grazie|thanks|thank you)[!.\s]*$/i.test(
    q,
  );
}
