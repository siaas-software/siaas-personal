import Decimal from "decimal.js";
import { AnalysisError } from "./types";

export const AnalysisDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export type BinaryOperator = "add" | "subtract" | "multiply" | "divide";

export function binaryDecimal(
  operator: BinaryOperator,
  left: Decimal,
  right: Decimal,
) {
  switch (operator) {
    case "add":
      return left.add(right);
    case "subtract":
      return left.sub(right);
    case "multiply":
      return left.mul(right);
    case "divide":
      if (right.isZero()) throw new AnalysisError("Division by zero.");
      return left.div(right);
  }
}
