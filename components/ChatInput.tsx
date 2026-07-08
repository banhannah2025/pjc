"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type CommandName = "/search" | "/save" | "/PRO";

type Command = {
  name: CommandName;
  label: string;
  description: string;
};

type ChatInputProps = {
  isSubmitting?: boolean;
  onSend: (message: string, proToggle: boolean) => Promise<void> | void;
};

const commands: Command[] = [
  {
    name: "/search",
    label: "Vector Search",
    description: "Trigger vector parsing for retrieval-aware prompts.",
  },
  {
    name: "/save",
    label: "Save File",
    description: "Trigger a file-writing execution workflow.",
  },
  {
    name: "/PRO",
    label: "Premium Engine",
    description: "Bypass triage and route directly to the pro model.",
  },
];

export function ChatInput({ isSubmitting = false, onSend }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [proToggle, setProToggle] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visibleCommands = useMemo(() => {
    if (!input.startsWith("/")) {
      return [];
    }

    const query = input.slice(1).toLowerCase();

    return commands.filter((command) =>
      command.name.slice(1).toLowerCase().startsWith(query)
    );
  }, [input]);

  const isCommandMenuVisible = visibleCommands.length > 0;

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const message = input.trim();
    if (!message || isSubmitting) {
      return;
    }

    try {
      await onSend(message, proToggle || /^\/PRO\b/i.test(message));
      setInput("");
      setActiveCommandIndex(0);
    } finally {
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isCommandMenuVisible) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveCommandIndex((index) => (index + 1) % visibleCommands.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveCommandIndex(
          (index) =>
            (index - 1 + visibleCommands.length) % visibleCommands.length
        );
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        applyCommand(visibleCommands[activeCommandIndex]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setInput("");
        setActiveCommandIndex(0);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  function applyCommand(command: Command | undefined) {
    if (!command) {
      return;
    }

    setInput(`${command.name} `);
    setActiveCommandIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col">
      <form className="relative" onSubmit={handleSubmit}>
        {isCommandMenuVisible && (
          <div
            className="absolute bottom-full left-0 right-0 z-20 mb-3 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/30"
            role="listbox"
            aria-label="Slash commands"
          >
            {visibleCommands.map((command, index) => (
              <button
                aria-selected={index === activeCommandIndex}
                className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition ${
                  index === activeCommandIndex
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800/70"
                }`}
                key={command.name}
                onClick={() => applyCommand(command)}
                role="option"
                type="button"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{command.name}</span>
                  <span className="block truncate text-sm text-slate-500">
                    {command.description}
                  </span>
                </span>
                <span className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-400">
                  {command.label}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-lg shadow-black/30 transition focus-within:border-slate-600">
          <textarea
            aria-label="Message"
            className="min-h-24 w-full resize-none bg-transparent px-1 py-1 text-base leading-6 text-slate-100 outline-none placeholder:text-slate-500"
            disabled={isSubmitting}
            onChange={(event) => {
              setInput(event.target.value);
              setActiveCommandIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything, or type / for commands"
            ref={textareaRef}
            value={input}
          />

          <div className="mt-3 flex flex-col gap-3 border-t border-slate-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm font-medium text-slate-300">
              <span>Pro</span>
              <button
                aria-checked={proToggle}
                aria-label="Force premium model"
                className={`relative h-6 w-11 rounded-full transition ${
                  proToggle
                    ? "bg-emerald-500"
                    : "bg-slate-700"
                }`}
                onClick={() => setProToggle((value) => !value)}
                role="switch"
                type="button"
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${
                    proToggle ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </div>

            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              disabled={isSubmitting || input.trim().length === 0}
              type="submit"
            >
              {isSubmitting ? "Sending" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
