/** Map uncased BERT pieces back to original UTF-16 DOM offsets, including accents. */
export function tokenOffsets(text: string, pieces: string[]): Array<{ start: number; end: number }> {
  const chars: string[] = [];
  const map: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const char of text) {
    const start = offset;
    offset += char.length;
    const normalized = char.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (!normalized && map.length) map[map.length - 1].end = offset;
    for (const unit of normalized) {
      // JS string indexes are UTF-16, so retain a mapping for each code unit.
      for (let i = 0; i < unit.length; i++) {
        chars.push(unit[i]);
        map.push({ start, end: offset });
      }
    }
  }
  const normalized = chars.join('');
  let cursor = 0;
  return pieces.map((piece, index) => {
    const needle = piece.replace(/^##/, '').toLowerCase();
    if (piece === '[UNK]') {
      while (/\s/.test(normalized[cursor] ?? '') && cursor < normalized.length) cursor++;
      const start = cursor;
      const next = pieces[index + 1]?.replace(/^##/, '').toLowerCase();
      const nextIndex = next ? normalized.indexOf(next, cursor + 1) : -1;
      let end = nextIndex >= 0 ? nextIndex : normalized.length;
      while (end > start && /\s/.test(normalized[end - 1])) end--;
      cursor = end;
      return { start: map[start]?.start ?? 0, end: map[end - 1]?.end ?? text.length };
    }
    const start = normalized.indexOf(needle, cursor);
    if (start < 0) return { start: 0, end: text.length };
    cursor = start + needle.length;
    return { start: map[start]?.start ?? 0, end: map[cursor - 1]?.end ?? text.length };
  });
}
