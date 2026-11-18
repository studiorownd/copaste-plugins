/**
 * The calculator in Search Applications (as in Raycast): a typed sum shows its answer above the
 * applications, and Return copies it. A small parser, never `eval`: numbers, + − × ÷ ^, brackets,
 * percentages ("200 + 10%" is 220, "15% of 80" is 12), a few functions and constants, and implicit
 * multiplication ("2(3+4)", "2pi"). Anything else, or a lone number, is not a sum.
 */

const FUNCTIONS = {
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log10,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};
const CONSTANTS = { e: Math.E, pi: Math.PI, π: Math.PI };
const OPERATORS = {
  '%': '%',
  '(': '(',
  ')': ')',
  '*': '*',
  '+': '+',
  '/': '/',
  '^': '^',
  '-': '-',
  '×': '*',
  '÷': '/',
  '−': '-',
};

function tokenize(text) {
  const tokens = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (/\s/.test(char)) {
      at += 1;
    } else if (/[\d.]/.test(char)) {
      const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(at));
      if (!match) return null;
      tokens.push({ kind: 'number', value: Number(match[0]) });
      at += match[0].length;
    } else if (text.startsWith('**', at)) {
      tokens.push({ kind: 'op', value: '^' });
      at += 2;
    } else if (OPERATORS[char]) {
      tokens.push({ kind: 'op', value: OPERATORS[char] });
      at += 1;
    } else if (
      /x/i.test(char) &&
      (tokens.at(-1)?.kind === 'number' || tokens.at(-1)?.value === ')') &&
      /^\s*[\d.(]/.test(text.slice(at + 1))
    ) {
      // "3x4", "3 x (1+1)": times, between numbers.
      tokens.push({ kind: 'op', value: '*' });
      at += 1;
    } else if (/[a-zπ]/i.test(char)) {
      const name = /^([a-z]+|π)/i.exec(text.slice(at))[0].toLowerCase();
      if (!(name in FUNCTIONS) && !(name in CONSTANTS) && name !== 'of') return null;
      tokens.push({ kind: 'name', value: name });
      at += name.length;
    } else {
      return null;
    }
  }
  return tokens;
}

/** Recursive descent, lowest precedence first; `null` for anything it doesn't know. */
function parse(tokens) {
  let at = 0;
  let operations = 0;
  const peek = () => tokens[at];
  const isOp = value => peek()?.kind === 'op' && peek().value === value;

  // A term that ends in "%" is a percentage: of what is left of a + or −, or of the number after "of".
  const expression = () => {
    let left = term();
    while (left !== null && (isOp('+') || isOp('-'))) {
      const op = tokens[at++].value;
      const start = at;
      const right = term();
      if (right === null) return null;
      const percent = tokens[at - 1]?.kind === 'op' && tokens[at - 1].value === '%' && at - 1 > start;
      const amount = percent ? left * right : right;
      left = op === '+' ? left + amount : left - amount;
      operations += 1;
    }
    return left;
  };

  const term = () => {
    let left = unary();
    while (left !== null) {
      if (isOp('*') || isOp('/')) {
        const op = tokens[at++].value;
        const right = unary();
        if (right === null) return null;
        left = op === '*' ? left * right : left / right;
        operations += 1;
      } else if (peek()?.kind === 'name' && peek().value === 'of') {
        at += 1;
        const right = unary();
        if (right === null) return null;
        left *= right;
        operations += 1;
      } else if (isOp('(') || (peek()?.kind === 'name' && peek().value !== 'of')) {
        // Implicit multiplication: 2(3+4), 2pi, (1+1)(2+2); never two bare numbers ("2 3").
        const right = power();
        if (right === null) return null;
        left *= right;
        operations += 1;
      } else {
        break;
      }
    }
    return left;
  };

  // A sign binds looser than ^, as on paper: -2^2 is -4, and 2^-1 is 0.5.
  const unary = () => {
    if (isOp('-') || isOp('+')) {
      const negative = isOp('-');
      at += 1;
      const value = unary();
      return value === null ? null : negative ? -value : value;
    }
    return power();
  };

  const power = () => {
    const base = postfix();
    if (base === null) return null;
    if (isOp('^')) {
      at += 1;
      const exponent = unary();
      if (exponent === null) return null;
      operations += 1;
      return base ** exponent;
    }
    return base;
  };

  const postfix = () => {
    let value = primary();
    while (value !== null && isOp('%')) {
      at += 1;
      value /= 100;
      operations += 1;
    }
    return value;
  };

  const primary = () => {
    const token = peek();
    if (!token) return null;
    if (token.kind === 'number') {
      at += 1;
      return token.value;
    }
    if (token.kind === 'op' && token.value === '(') {
      at += 1;
      const value = expression();
      if (value === null || !isOp(')')) return null;
      at += 1;
      return value;
    }
    if (token.kind === 'name' && token.value in CONSTANTS) {
      at += 1;
      return CONSTANTS[token.value];
    }
    if (token.kind === 'name' && token.value in FUNCTIONS) {
      at += 1;
      const argument = isOp('(') ? primary() : postfix();
      if (argument === null) return null;
      operations += 1;
      return FUNCTIONS[token.value](argument);
    }
    return null;
  };

  const value = expression();
  if (value === null || at !== tokens.length) return null;
  return { operations, value };
}

/** The answer as it is copied: no grouping, no float noise (0.1 + 0.2 is 0.3). */
function formatAnswer(value) {
  if (Object.is(value, -0)) return '0';
  return String(Number(value.toPrecision(12)));
}

function calculate(query) {
  const expression = query.trim();
  if (!expression || expression.length > 128 || !/\d|pi|π/i.test(expression)) return null;
  const tokens = tokenize(expression);
  if (!tokens?.length) return null;
  const result = parse(tokens) ?? parse(finished(tokens));
  // A lone number or constant is a search, not a sum; "66 +" already is one.
  const typingOn = /[-+*/^×÷−(]\s*$|\bof\s*$/i.test(expression);
  if (!result || (result.operations === 0 && !typingOn) || !Number.isFinite(result.value)) return null;
  return { answer: formatAnswer(result.value), expression, value: result.value };
}

/**
 * A sum still being typed, as far as it goes (as in Raycast and Spotlight): an operator at the end
 * waits for its number ("1 +" is 1, "2*(3+" is 6) and open brackets are closed, so the answer
 * does not come and go between keystrokes.
 */
function finished(tokens) {
  const done = [...tokens];
  const pending = token =>
    (token?.kind === 'op' && token.value !== ')' && token.value !== '%') ||
    (token?.kind === 'name' && token.value === 'of');
  while (pending(done.at(-1))) done.pop();
  let open = 0;
  for (const token of done) {
    if (token.kind === 'op' && token.value === '(') open += 1;
    else if (token.kind === 'op' && token.value === ')') open -= 1;
  }
  for (; open > 0; open -= 1) done.push({ kind: 'op', value: ')' });
  return done;
}

globalThis.copastePlugin = { evaluate: calculate };
