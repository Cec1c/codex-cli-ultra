if (!process.env.NODE_TEST_CONTEXT) {
  process.stdin.setEncoding("utf8");
  let input = "";
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    process.stdout.write(
      JSON.stringify({
        args: process.argv.slice(2),
        input,
        locale: process.env.CODEX_ULTRA_LOCALE ?? null
      })
    );
    process.stderr.write("child-stderr\n");
    process.exitCode = Number(process.env.CHILD_EXIT_CODE ?? 0);
  });
}
