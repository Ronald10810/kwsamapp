export function getArgValue(flag: string): string | undefined {
  const index = process.argv.findIndex((item) => item === flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }

  return process.argv[index + 1];
}

export function requiredArg(flag: string, defaultValue?: string): string {
  const value = getArgValue(flag) ?? defaultValue;
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }

  return value;
}

export function optionalArg(flag: string, defaultValue: string): string {
  return getArgValue(flag) ?? defaultValue;
}
