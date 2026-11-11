import { describe, expect, test } from "bun:test";
import { checkExample, checkMarkdown, type Reference } from "./docs";

const ref: Reference = {
  help: "Usage:\n  herdr-app status\n  herdr-app ls\n  herdr-app do <command> [args]\n  herdr-app commands\n  herdr-app --skill\n  herdr-app --version\n",
  commands: [{ name: "pane.split", about: "Split a pane.", args: [{ name: "direction", required: true }] }],
};

describe("CLI examples", () => {
  test("validates commands and named arguments without executing examples", () => {
    for (const source of ["herdr-app", "herdr-app ls", "herdr-app --help", "herdr-app --skill", "herdr-app do pane.split --direction right", `herdr-app do pane.split '{"direction":"right"}'`]) {
      expect(checkExample(source, ref)).toEqual([]);
    }
    expect(checkExample("herdr-app wat", ref)).toEqual(["unknown command or flag: wat"]);
    expect(checkExample("herdr-app ls && herdr-app wat", ref)).toEqual(["unknown command or flag: wat"]);
    expect(checkExample("herdr-app --wat", ref)).toHaveLength(1);
    expect(checkExample("herdr-app ls --wat", ref)).toHaveLength(1);
    expect(checkExample("herdr-app do pane.wat", ref)).toHaveLength(1);
    expect(checkExample("herdr-app do pane.split --wat right", ref)).toHaveLength(1);
    expect(checkExample("herdr-app do pane.split --direction=right", ref)).toContain("unknown flag for do: --direction=right");
    expect(checkExample("herdr-app do pane.split --direction='right'", ref)).toContain("unknown flag for do: --direction=right");
    expect(checkExample('herdr-app ls "--wat"', ref)).toEqual(["unknown flag for ls: --wat"]);
    expect(checkExample('herdr-app do pane.split "--wat" right', ref)).toEqual(["unknown flag for do: --wat"]);
    expect(checkExample('herdr-app do pane.split "--direction" "right"', ref)).toEqual([]);
    expect(checkExample("herdr-app do pane.split --direction", ref)).toEqual(["missing value for --direction"]);
  });

  test("validates explicit window selection without losing app-command validation", () => {
    const targeted = {...ref, help: ref.help.replace("herdr-app do", "herdr-app [--window N] do") + "  herdr-app windows\n"};
    expect(checkExample("herdr-app --window 2 do pane.split --direction right", targeted)).toEqual([]);
    expect(checkExample("herdr-app --window <id> status", targeted)).toEqual([]);
    expect(checkExample("herdr-app windows", targeted)).toEqual([]);
    for (const id of ["0", "-1", "4294967296", "wat"]) {
      expect(checkExample(`herdr-app --window ${id} status`, targeted)).toEqual(["--window needs a positive numeric window ID"]);
    }
    expect(checkExample("herdr-app --window", targeted)).toEqual(["--window needs a positive numeric window ID"]);
    expect(checkExample("herdr-app --window 2", targeted)).toEqual(["--window needs a command"]);
    expect(checkExample("herdr-app --window 2 commands", targeted)).toEqual(["--window cannot be used with commands"]);
    expect(checkExample("herdr-app --window 2 do pane.wat", targeted)).toEqual(["unknown app command: pane.wat"]);
    expect(checkExample("herdr-app --window 2 do pane.split --wat right", targeted)).toEqual(["unknown flag for do: --wat"]);
  });

  test("ignores flags inside quotes and comments, and other programs", () => {
    expect(checkExample(`herdr-app do pane.split --direction '--not-a-flag' # --comment`, ref)).toEqual([]);
    expect(checkExample("curl --not-our-flag https://example.org", ref)).toEqual([]);
    expect(checkExample("herdr-app ls | other --not-our-flag", ref)).toEqual([]);
    expect(checkExample("herdr-app do pane.split --direction herdr-app", ref)).toEqual([]);
  });

  test("reports inline and fenced examples with file and line", () => {
    expect(checkMarkdown("README.md", "Text `herdr-app wat`.\n\n```sh\nherdr-app ls --wat\n```", ref)).toEqual([
      "README.md:1: unknown command or flag: wat",
      "README.md:4: unknown flag for ls: --wat",
    ]);
    expect(checkMarkdown("docs/example.md", "~~~sh\nherdr-app do pane.split \\\n  --wat right\n~~~", ref)).toEqual(["docs/example.md:2: unknown flag for do: --wat"]);
    expect(checkMarkdown("README.md", "Plain prose herdr-app wat is not code.", ref)).toEqual([]);
  });
});


