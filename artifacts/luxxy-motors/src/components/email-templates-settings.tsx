import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import type { EmailTemplate } from "@workspace/vehicle-meta";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Textarea } from "./ui/textarea";
import "./integration-settings.css";

type Templates = {
  revision: number;
  templates: EmailTemplate[];
  variables: string[];
};
const request = <T,>(method = "GET", body?: unknown) =>
  customFetch<T>("/api/email-templates", {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
export function EmailTemplatesSettings() {
  const [data, setData] = useState<Templates | null>(null),
    [selected, setSelected] = useState("enquiry_acknowledgement");
  const [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = data?.templates.find((item) => item.id === selected);
  const dirty = Boolean(
    active && (subject !== active.subject || body !== active.body),
  );
  function apply(value: Templates, id = selected) {
    setData(value);
    const current = value.templates.find((item) => item.id === id);
    if (current) {
      setSubject(current.subject);
      setBody(current.body);
    }
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      apply(await request<Templates>());
    } catch {
      setError("Message wording could not be loaded. Try again.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(reset = false) {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      apply(
        await request<Templates>("PUT", {
          id: selected,
          expectedRevision: data.revision,
          ...(reset
            ? { reset: true }
            : { subject, body, headline: active?.headline ?? "" }),
        }),
      );
      setNotice("Wording saved for future emails. No message was sent.");
    } catch {
      setError(
        "Wording could not be saved. Your edits are kept. Reload if another owner changed the messages.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="integration-settings"
      aria-label="Email message wording"
      data-settings-dirty={dirty}
    >
      <header className="integration-heading">
        <div>
          <h3>Email wording</h3>
          <p>
            Edit the messages staff use. Branding follows the dealership logo
            and colour.
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="integration-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <Button disabled={busy} onClick={() => void load()}>
          {busy ? "Loading messages…" : "Try again"}
        </Button>
      ) : (
        <fieldset disabled={busy} className="space-y-5">
          <label className="integration-field">
            Message type
            <NativeSelect
              value={selected}
              onChange={(e) => {
                const id = e.target.value;
                if (
                  !dirty ||
                  window.confirm(
                    "Discard the unsaved wording for this message?",
                  )
                ) {
                  setSelected(id);
                  apply(data, id);
                  setNotice("");
                }
              }}
            >
              {data.templates
                .filter(
                  (item) =>
                    !["Reservations", "Customer access"].includes(
                      item.category,
                    ) &&
                    !["service_history", "pre_accident_photos"].includes(
                      item.id,
                    ),
                )
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
            </NativeSelect>
          </label>
          <label className="integration-field">
            Subject
            <Input
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="integration-field">
            Message
            <Textarea
              rows={10}
              maxLength={12000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Keep details inside double braces, such as {"{{customer_name}}"}, so
            the recorded customer and vehicle information fills in correctly.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={!dirty} onClick={() => void save()}>
              Save wording
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!dirty || window.confirm("Discard these unsaved changes?"))
                  void load();
              }}
            >
              Reload saved wording
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    "Restore the default wording for this message?",
                  )
                )
                  void save(true);
              }}
            >
              Restore default
            </Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
