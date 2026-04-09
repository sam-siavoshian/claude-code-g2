def calculate(a, op, b):
    if op == '+': return a + b
    if op == '-': return a - b
    if op == '*': return a * b
    if op == '/':
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b
    raise ValueError(f"Unknown operator: {op}")

print("Basic Calculator (type 'quit' to exit)")
while True:
    expr = input("> ").strip()
    if expr.lower() == 'quit':
        break
    try:
        for op in ('+', '-', '*', '/'):
            if op in expr:
                parts = expr.split(op, 1)
                a, b = float(parts[0]), float(parts[1])
                print(calculate(a, op, b))
                break
        else:
            print("Enter an expression like: 3 + 4")
    except ValueError as e:
        print(f"Error: {e}")
    except Exception:
        print("Invalid input")
