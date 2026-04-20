export function getArgValue(flag) {
    const index = process.argv.findIndex((item) => item === flag);
    if (index === -1 || index + 1 >= process.argv.length) {
        return undefined;
    }
    return process.argv[index + 1];
}
export function requiredArg(flag, defaultValue) {
    const value = getArgValue(flag) ?? defaultValue;
    if (!value) {
        throw new Error(`Missing required argument: ${flag}`);
    }
    return value;
}
export function optionalArg(flag, defaultValue) {
    return getArgValue(flag) ?? defaultValue;
}
//# sourceMappingURL=args.js.map