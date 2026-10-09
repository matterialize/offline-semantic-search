export function isQuestion(query: string): boolean {
  return /^\s*(?:which|what|where|when|who|why|how|is|are|was|were|does|do|did|can|could|will|would|should)\b/iu.test(query);
}
