# Synthetic analytical examples

These non-confidential fixtures are for repeatable local testing. All columns are
suggestions; explicitly confirm mappings and relationships in Knowledge.

| File | Expected result |
| --- | --- |
| orders.csv | Total Quantity 15: A=10, B=5 |
| operations.xlsx / Inventory | A available 8, B available 9; A shortage 2, B spare 4 |
| operations.xlsx / BOM + Materials | M1 demand 25, available 20, shortage 5 |
| transactions.csv | EUR income 100, expenses 30, balance 70; USD expense 4 separately |
| budgets.csv | October Food EUR budget 35, actual 30, remaining 5 |
| duplicates.csv | Two T1 rows are duplicate candidates; separate from transaction totals |

Use Product and Material keys only after confirming matching values/cardinality.
Amounts are positive with an explicit Type field. Currency must remain a partition.
No formula recalculation, optimization or currency conversion is assumed. Blank
cells are missing values, not zero. The workbook has three sheets and no macros.
