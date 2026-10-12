export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function similarity(a: string, b: string): number {
  const x = normalizeTitle(a).slice(0, 300),
    y = normalizeTitle(b).slice(0, 300);
  if (!x || !y) return 0;
  if (x === y) return 1;
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++)
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return 1 - row[y.length]! / Math.max(x.length, y.length);
}

export function cleanMediaTitle(raw: string): string {
  let title = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b\d+\s*[-_.]*\s*sezon\s*[-_.]*\s*\d+\s*[-_.]*\s*bolum\b/gi, ' ')
    .replace(/\bsezon\s*[-_.]*\s*\d+\s*[-_.]*\s*bolum\s*[-_.]*\s*\d+\b/gi, ' ')
    .replace(/\bs\d+\s*e\d+\b/gi, ' ')
    .replace(/\b\d+\s*[-_.]*\s*sezon\b/gi, ' ')
    .replace(/\b\d+\s*[-_.]*\s*bolum\b/gi, ' ')
    .replace(/\b(turkce|turkçe)\s+(dublaj|altyazi|altyazili)\b/gi, ' ')
    .replace(
      /\b(dublaj|altyazi|altyazili|dual|cift\s*ses|orijinal\s*ses)\b/gi,
      ' ',
    )
    .replace(
      /\b(full\s*hd|hd|1080p|720p|4k|uhd|bluray|web\s*dl|webrip|dvdrip)\b/gi,
      ' ',
    )
    .replace(
      /\b(izle|filmi|filmini|dizisi|dizisini|tek\s*parca|sinema|seyret)\b/gi,
      ' ',
    )
    .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  title = title.replace(/^(?:the|a|an)\s+/i, '');
  return title;
}

export function generateTitleVariants(raw: string): string[] {
  const variants = new Set<string>();
  const trimmed = raw.trim();
  if (!trimmed) return [];
  variants.add(trimmed);

  // Without leading articles
  const noArticle = trimmed.replace(
    /^(?:the|a|an|der|die|das|le|la|el|il)\s+/i,
    '',
  );
  if (noArticle !== trimmed && noArticle) variants.add(noArticle);

  // Word numbers <-> Arabic numbers
  const numberWordPairs: [RegExp, string][] = [
    [/\bpart\s+one\b/gi, 'Part 1'],
    [/\bpart\s+two\b/gi, 'Part 2'],
    [/\bpart\s+three\b/gi, 'Part 3'],
    [/\bpart\s+four\b/gi, 'Part 4'],
    [/\bpart\s+five\b/gi, 'Part 5'],
    [/\bpart\s+1\b/gi, 'Part One'],
    [/\bpart\s+2\b/gi, 'Part Two'],
    [/\bpart\s+3\b/gi, 'Part Three'],
    [/\bpart\s+4\b/gi, 'Part Four'],
    [/\bpart\s+5\b/gi, 'Part Five'],
  ];
  for (const [pattern, repl] of numberWordPairs) {
    if (pattern.test(trimmed)) {
      variants.add(trimmed.replace(pattern, repl));
    }
  }

  // Turkish Part / Bölüm / Kısım translations
  const trPartPairs: [RegExp, string][] = [
    [/\bpart\s+one\b/gi, 'Bölüm 1'],
    [/\bpart\s+one\b/gi, 'Bölüm Bir'],
    [/\bpart\s+two\b/gi, 'Bölüm 2'],
    [/\bpart\s+two\b/gi, 'Bölüm İki'],
    [/\bpart\s+three\b/gi, 'Bölüm 3'],
    [/\bpart\s+three\b/gi, 'Bölüm Üç'],
    [/\bpart\s+four\b/gi, 'Bölüm 4'],
    [/\bpart\s+five\b/gi, 'Bölüm 5'],
    [/\bpart\s+1\b/gi, 'Bölüm 1'],
    [/\bpart\s+1\b/gi, 'Bölüm Bir'],
    [/\bpart\s+2\b/gi, 'Bölüm 2'],
    [/\bpart\s+2\b/gi, 'Bölüm İki'],
    [/\bpart\s+3\b/gi, 'Bölüm 3'],
    [/\bpart\s+4\b/gi, 'Bölüm 4'],
    [/\bpart\s+5\b/gi, 'Bölüm 5'],
    [/\bpart\s+(\d+)\b/gi, '$1'],
    [/\bbolum\s+iki\b/gi, '2'],
    [/\bbolum\s+bir\b/gi, '1'],
    [/\bbolum\s+uc\b/gi, '3'],
  ];
  for (const [pattern, repl] of trPartPairs) {
    if (pattern.test(trimmed)) {
      variants.add(trimmed.replace(pattern, repl));
    }
  }

  // Roman numerals conversion: "Part II" -> "Part 2", " II" -> " 2"
  const romanToArabic: [RegExp, string][] = [
    [/\b(part\s+)?x\b/gi, '$110'],
    [/\b(part\s+)?ix\b/gi, '$19'],
    [/\b(part\s+)?viii\b/gi, '$18'],
    [/\b(part\s+)?vii\b/gi, '$17'],
    [/\b(part\s+)?vi\b/gi, '$16'],
    [/\b(part\s+)?v\b/gi, '$15'],
    [/\b(part\s+)?iv\b/gi, '$14'],
    [/\b(part\s+)?iii\b/gi, '$13'],
    [/\b(part\s+)?ii\b/gi, '$12'],
  ];
  for (const [pattern, repl] of romanToArabic) {
    if (pattern.test(trimmed)) {
      variants.add(trimmed.replace(pattern, repl));
    }
  }

  // Arabic to Roman numerals for numbers 2..5
  const arabicToRoman: [RegExp, string][] = [
    [/\bpart\s+2\b/gi, 'Part II'],
    [/\bpart\s+3\b/gi, 'Part III'],
    [/\bpart\s+4\b/gi, 'Part IV'],
    [/\bpart\s+5\b/gi, 'Part V'],
    [/\s+2\b/g, ' II'],
    [/\s+3\b/g, ' III'],
  ];
  for (const [pattern, repl] of arabicToRoman) {
    if (pattern.test(trimmed)) {
      variants.add(trimmed.replace(pattern, repl));
    }
  }

  // Colon and dash separated titles (Main: Sub -> Main, Main Sub, Sub)
  const separators = [':', ' - ', ' – ', ' — '];
  for (const sep of separators) {
    if (trimmed.includes(sep)) {
      const parts = trimmed
        .split(sep)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts[0]) {
        variants.add(parts[0]);
        // Also remove articles from the main part
        const cleanPart0 = parts[0].replace(/^(?:the|a|an)\s+/i, '');
        if (cleanPart0) variants.add(cleanPart0);
      }
      if (parts.length > 1) {
        variants.add(parts.join(' '));
      }
    }
  }

  // Ampersand variations: " & " <-> " and ", " ve "
  if (trimmed.includes('&')) {
    variants.add(trimmed.replace(/&/g, 'and'));
    variants.add(trimmed.replace(/&/g, 've'));
  }
  if (/\band\b/i.test(trimmed)) {
    variants.add(trimmed.replace(/\band\b/gi, '&'));
  }

  // Hyphenated word variations: Spider-Man -> Spider Man, Spiderman, SpiderMan
  if (trimmed.includes('-')) {
    variants.add(trimmed.replace(/-/g, ' '));
    variants.add(trimmed.replace(/-/g, ''));
    variants.add(
      trimmed.replace(/-([a-zA-Z])/g, (_, c: string) => c.toLowerCase()),
    );
  }

  // Parentheses removal (e.g. "Shameless (US)" -> "Shameless")
  if (/\([^)]*\)/.test(trimmed)) {
    const noParen = trimmed.replace(/\([^)]*\)/g, '').trim();
    if (noParen) variants.add(noParen);
  }

  return [...variants];
}

export function scoreTitleMatch(candidate: string, target: string): number {
  const normC = normalizeTitle(candidate);
  const normT = normalizeTitle(target);
  if (!normC || !normT) return 0;
  if (normC === normT) return 1;

  const cleanC = cleanMediaTitle(candidate);
  const cleanT = cleanMediaTitle(target);
  if (cleanC && cleanT && cleanC === cleanT) return 0.98;

  // Substring containment only if the shorter title has sufficient length
  const minLen = Math.min(cleanC.length, cleanT.length);
  const maxLen = Math.max(cleanC.length, cleanT.length);
  if (minLen >= 4 && (cleanC.includes(cleanT) || cleanT.includes(cleanC))) {
    const lenRatio = minLen / maxLen;
    if (lenRatio >= 0.75) return 0.92;
  }

  // Token-based matching and number consistency
  const tokensC = cleanC.split(/\s+/).filter(Boolean);
  const tokensT = cleanT.split(/\s+/).filter(Boolean);
  if (tokensC.length > 0 && tokensT.length > 0) {
    const numRegex = /^\d+$/;
    const numsC = new Set(tokensC.filter((t) => numRegex.test(t)));
    const numsT = new Set(tokensT.filter((t) => numRegex.test(t)));

    // If both contain numbers and have zero overlap (e.g. 1 vs 2), penalize to 0
    if (numsC.size > 0 && numsT.size > 0) {
      const hasOverlap = [...numsC].some((n) => numsT.has(n));
      if (!hasOverlap) return 0;
    }

    const setC = new Set(tokensC);
    const setT = new Set(tokensT);
    const common = [...setT].filter((t) => setC.has(t));
    const targetCoverage = common.length / setT.size;
    if (targetCoverage >= 0.75 && common.length >= 2) {
      return 0.93;
    }
  }

  return Math.max(similarity(normC, normT), similarity(cleanC, cleanT));
}
