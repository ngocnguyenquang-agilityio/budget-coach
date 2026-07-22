// Ported from my-ag-ui-client/src/calculator.ts for the browser-side "calculate" frontend tool.

type Token =
  | { type: "number"; value: number }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" };

const OPERATORS: Record<string, { precedence: number; rightAssoc: boolean }> = {
  "+": { precedence: 1, rightAssoc: false },
  "-": { precedence: 1, rightAssoc: false },
  "*": { precedence: 2, rightAssoc: false },
  "/": { precedence: 2, rightAssoc: false },
  "%": { precedence: 2, rightAssoc: false },
  "^": { precedence: 3, rightAssoc: true },
  // internal marker for unary minus, injected by the tokenizer
  u: { precedence: 4, rightAssoc: true },
};

/**
 * Turns an expression string into a token stream. Throws a plain Error with
 * a human-readable message on any unrecognized character or malformed number
 * — callers must catch, this never returns a partial/invalid token list.
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
      const raw = expr.slice(start, i);
      const value = Number(raw);
      if (raw === "" || raw === "." || Number.isNaN(value)) {
        throw new Error(`Invalid number "${raw}" at position ${start}`);
      }
      tokens.push({ type: "number", value });
      continue;
    }

    if ("+-*/%^".includes(ch)) {
      // Unary minus: '-' at the start, or right after another operator/'('
      const prev = tokens[tokens.length - 1];
      const isUnary =
        ch === "-" &&
        (prev === undefined || prev.type === "op" || prev.type === "lparen");
      tokens.push({ type: "op", value: isUnary ? "u" : ch });
      i++;
      continue;
    }

    throw new Error(`Unrecognized character "${ch}" at position ${i}`);
  }

  return tokens;
}

/** Shunting-yard: infix tokens -> RPN token queue. */
function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const opStack: Token[] = [];

  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
    } else if (token.type === "op") {
      const info = OPERATORS[token.value];
      while (opStack.length > 0) {
        const top = opStack[opStack.length - 1];
        if (top.type !== "op") break;
        const topInfo = OPERATORS[top.value];
        const shouldPop = info.rightAssoc
          ? topInfo.precedence > info.precedence
          : topInfo.precedence >= info.precedence;
        if (!shouldPop) break;
        output.push(opStack.pop()!);
      }
      opStack.push(token);
    } else if (token.type === "lparen") {
      opStack.push(token);
    } else if (token.type === "rparen") {
      let foundLparen = false;
      while (opStack.length > 0) {
        const top = opStack.pop()!;
        if (top.type === "lparen") {
          foundLparen = true;
          break;
        }
        output.push(top);
      }
      if (!foundLparen) {
        throw new Error('Mismatched parentheses: unexpected ")"');
      }
    }
  }

  while (opStack.length > 0) {
    const top = opStack.pop()!;
    if (top.type === "lparen" || top.type === "rparen") {
      throw new Error('Mismatched parentheses: unclosed "("');
    }
    output.push(top);
  }

  return output;
}

/** Evaluates an RPN token queue, throwing on malformed expressions or math errors. */
function evalRpn(rpn: Token[]): number {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }

    if (token.type !== "op") {
      throw new Error("Malformed expression");
    }

    if (token.value === "u") {
      const a = stack.pop();
      if (a === undefined) throw new Error("Malformed expression");
      stack.push(-a);
      continue;
    }

    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) {
      throw new Error("Malformed expression");
    }

    switch (token.value) {
      case "+":
        stack.push(a + b);
        break;
      case "-":
        stack.push(a - b);
        break;
      case "*":
        stack.push(a * b);
        break;
      case "/":
        if (b === 0) throw new Error("Division by zero");
        stack.push(a / b);
        break;
      case "%":
        if (b === 0) throw new Error("Modulo by zero");
        stack.push(a % b);
        break;
      case "^":
        stack.push(Math.pow(a, b));
        break;
      default:
        throw new Error(`Unknown operator "${token.value}"`);
    }
  }

  if (stack.length !== 1) {
    throw new Error("Malformed expression");
  }

  return stack[0];
}

/**
 * Safely evaluates an arithmetic expression string. Never throws — all
 * failures (bad syntax, unbalanced parens, divide by zero, etc.) are
 * reported via the returned result so they can be relayed back to the model
 * as a tool result.
 */
export function evaluateExpression(
  expr: string,
): { ok: boolean; value?: number; message: string } {
  if (typeof expr !== "string" || expr.trim() === "") {
    return { ok: false, message: "Refused to evaluate: expression is empty." };
  }

  try {
    const tokens = tokenize(expr);
    if (tokens.length === 0) {
      return { ok: false, message: "Refused to evaluate: expression is empty." };
    }
    const rpn = toRpn(tokens);
    const value = evalRpn(rpn);

    if (!Number.isFinite(value)) {
      return {
        ok: false,
        message: `Expression "${expr}" produced a non-finite result.`,
      };
    }

    return { ok: true, value, message: `Result: ${value}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Failed to evaluate "${expr}": ${detail}`,
    };
  }
}
