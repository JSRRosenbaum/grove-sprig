//! Legacy plugin adapters execute outside the UI thread; results remain bound to their source pane.
use super::*;
use std::io::{Read, Write};
use std::process::Stdio;

fn invoke(request: Value) -> Result<Value, String> {
    let helper = mods::app_dir().join("legacy_plugins.py");
    let python = if cfg!(windows) { "python" } else { "python3" };
    let mut child = crate::spawn::command(python).arg(helper)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Cannot start legacy plugin: {e}"))?;
    let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().ok_or("Plugin stdin unavailable")?;
    let writer = std::thread::spawn(move || input.write_all(&bytes));
    let stdout = child.stdout.take().ok_or("Plugin stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Plugin stderr unavailable")?;
    let output = std::thread::spawn(move || { let mut bytes = Vec::new(); stdout.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes).map(|_| bytes) });
    let errors = std::thread::spawn(move || { let mut bytes = Vec::new(); stderr.take(65537).read_to_end(&mut bytes).map(|_| bytes) });
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            None => { let _ = child.kill(); let _ = child.wait(); return Err("Legacy plugin timed out".into()); }
        }
    };
    writer.join().map_err(|_| "Plugin input worker failed")?.map_err(|e| e.to_string())?;
    let output = output.join().map_err(|_| "Plugin output worker failed")?.map_err(|e| e.to_string())?;
    let errors = errors.join().map_err(|_| "Plugin error worker failed")?.map_err(|e| e.to_string())?;
    if output.len() > 8 * 1024 * 1024 || errors.len() > 65536 { return Err("Legacy plugin response exceeds its output limit".into()); }
    if !status.success() { return Err(format!("Legacy plugin exited {status}: {}", String::from_utf8_lossy(&errors))); }
    let response: Value = serde_json::from_slice(&output).map_err(|e| format!("Invalid legacy plugin response: {e}"))?;
    if response["ok"] != true { return Err(response["error"].as_str().unwrap_or("Legacy plugin failed").into()); }
    Ok(response)
}

/// Validate the complete plan before creating any terminal. References only name earlier steps.
fn plan_steps(plan: &Value) -> Result<Vec<(String, String, String, Vec<String>)>, String> {
    let steps = plan["steps"].as_array().ok_or("Missing split plan steps")?;
    if steps.is_empty() || steps.len() > 32 { return Err("Invalid split plan size".into()); }
    let mut known = HashSet::from(["root".to_owned()]);
    steps.iter().map(|step| {
        let id = step["id"].as_str().filter(|s| !s.is_empty()).ok_or("Missing split step id")?;
        let from = step["from"].as_str().ok_or("Missing split parent")?;
        let direction = step["direction"].as_str().filter(|s| matches!(*s, "right" | "down")).ok_or("Invalid split direction")?;
        let argv: Vec<String> = serde_json::from_value(step["argv"].clone()).map_err(|_| "Invalid split argv")?;
        if !known.contains(from) || known.contains(id) || argv.is_empty() || argv[0].is_empty() { return Err("Invalid split dependency or argv".into()); }
        known.insert(id.into());
        Ok((id.into(), from.into(), direction.into(), argv))
    }).collect()
}

impl AppWindow {
    fn legacy_popup(&mut self, spec: &Value, machine: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Result<(), String> {
        let argv = Self::argv(spec).filter(|v| !v.is_empty() && !v[0].is_empty()).ok_or("Plugin popup has no command")?;
        let cell = crate::terminal::cell_size(window);
        let dimension = |name: &str, cell: Pixels| -> Result<f32, String> {
            let value = &spec[name];
            if value.is_null() { return Ok(0.8); }
            if let Some(count) = value.as_u64().filter(|count| *count > 0 && *count <= 65535) {
                return Ok(f32::from(cell) * count as f32 / settings::zoom());
            }
            if let Some(percent) = value.as_str().and_then(|s| s.strip_suffix('%')).and_then(|s| s.parse::<f32>().ok())
                .filter(|n| *n > 0.0 && *n <= 100.0) {
                return Ok(percent / 100.0);
            }
            Err(format!("Invalid popup {name}"))
        };
        let size = size(dimension("width", cell.width)?, dimension("height", cell.height)?);
        let address = self.open_transient_terminal(argv, Self::owned(spec, "cwd"), machine, None, window, cx)?;
        if let Some(overlay) = self.overlays.iter_mut().find(|overlay| overlay.transient_terminal.as_deref() == Some(address.as_str())) {
            overlay.size = size;
        }
        cx.notify();
        Ok(())
    }

    pub(super) fn run_legacy_plugin(&mut self, args: &Value, window: &mut Window, cx: &mut Context<Self>) {
        let result = (|| {
            let action = Self::arg(args, "action").ok_or("Missing legacy plugin action")?;
            let pane = Self::owned(args, "pane").or_else(|| self.model.focused_pane()).ok_or("No source pane")?;
            let address = self.model.address_of(&pane).ok_or("No source terminal")?;
            let space = self.model.space_of(&pane).ok_or("No source workspace")?;
            let tab = self.model.tab_of(&pane).ok_or("No source tab")?;
            self.require_document(space.machine.as_deref())?;
            let mut request = json!({"action":action,"pane":pane,"terminal":address,"space":space.id,
                "space_label":space.name,"tab_label":tab.name,"pane_count":tab.root.panes().len(),
                "cwd":self.cwds.get(&address).cloned().unwrap_or_else(|| space.folder.clone()),
                "machine":space.machine,"local":space.machine.is_none(),"window":crate::instances::id(),
                "app":std::env::current_exe().map_err(|e| e.to_string())?,"core":crate::core_bin::path(),
                "selection":(action == "annotate.capture").then(|| self.pane_term(&pane).and_then(|t| t.view.read(cx).selected_text())).flatten(),
                "clipboard":(action == "annotate.capture").then(|| cx.read_from_clipboard().and_then(|item| item.text())).flatten(),
                "terminal_record":self.live.get(&address)});
            if let Some(encoded) = action.strip_prefix("custom:") {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded).map_err(|_| "Invalid legacy shell action")?;
                let custom: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid legacy shell action JSON")?;
                if custom["action"] != "shell" || custom["command"].as_str().is_none() { return Err("Invalid legacy shell command".into()); }
                for key in ["action", "command", "type", "width", "height"] { request[key] = custom[key].clone(); }
            }
            Ok::<_, String>((pane, address, space.machine.clone(), request))
        })();
        let (pane, address, machine, request) = match result { Ok(v) => v, Err(e) => return self.fail(e) };
        let generation = self.core_generation;
        let core = self.core.clone();
        cx.spawn_in(window, async move |this, cx| {
            let source = address.clone();
            let result = cx.background_executor().spawn(async move {
                let mut request = request;
                let current = core.call("terminal.get", json!({"terminal":source})).map_err(|e| e.to_string())?;
                let captured = &request["terminal_record"];
                if captured.is_null() || current["created_ms"] != captured["created_ms"]
                    || current["foreground"] != captured["foreground"]
                    || current["state"] != "live" {
                    return Err("The source process changed before the plugin started".to_owned());
                }
                request["terminal_record"] = current;
                invoke(request)
            }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                let result = (|| {
                    if generation != this.core_generation || this.draining
                        || this.model.address_of(&pane).as_deref() != Some(address.as_str())
                        || this.model.space_of(&pane).and_then(|s| s.machine.clone()) != machine {
                        return Err("The source terminal changed before the plugin completed".to_owned());
                    }
                    this.require_document(machine.as_deref())?;
                    let response = result?;
                    if let Some(text) = response["clipboard"].as_str() {
                        cx.write_to_clipboard(ClipboardItem::new_string(text.into()));
                        this.open_overlay(mods::new_overlay_id(), json!({"kind":"toast","notification":{"title":"Copied","body":"","timeout":1500}}), window, cx);
                    }
                    if let Some(plan) = response.get("split_plan") {
                        let steps = plan_steps(plan)?;
                        if plan["pane"].as_str() != Some(pane.as_str()) || this.model.tab_of(&pane).is_none_or(|t| t.root.panes().len() != 1) {
                            return Err("The sci-fi grid needs the unchanged, unsplit source tab".into());
                        }
                        let mut ids = HashMap::from([("root".to_owned(), pane.clone())]);
                        let mut failure = None;
                        for (id, from, direction, argv) in steps {
                            let reply = this.run_as("pane.split", json!({"pane":ids[&from],"direction":direction,"argv":argv}), false, window, cx);
                            if let Some(created) = reply["pane"].as_str() { ids.insert(id, created.to_owned()); }
                            else { failure = Some(reply["error"].as_str().unwrap_or("Split returned no pane").to_owned()); break; }
                        }
                        this.run_as("pane.focus", json!({"pane":pane}), false, window, cx);
                        if let Some(error) = failure { return Err(format!("Grid stopped after {} splits: {error}", ids.len() - 1)); }
                    }
                    if let Some(popup) = response.get("popup") {
                        this.legacy_popup(popup, None, window, cx)?;
                    }
                    if let Some(launch) = response.get("launch") {
                        if launch["pane"].as_str() != Some(pane.as_str()) { return Err("Plugin launch changed its source pane".into()); }
                        let argv = Self::argv(launch).filter(|v| !v.is_empty() && !v[0].is_empty()).ok_or("Plugin launch has no command")?;
                        if launch["placement"].as_str() == Some("overlay") {
                            this.open_transient_terminal(argv, Self::owned(launch, "cwd"), machine.clone(), None, window, cx)?;
                        } else if launch["placement"].as_str() == Some("popup") {
                            this.legacy_popup(launch, machine.clone(), window, cx)?;
                        } else {
                            let reply = this.run_as("pane.split", json!({"pane":pane,"direction":launch["direction"],"argv":argv}), false, window, cx);
                            if let Some(error) = reply["error"].as_str() { return Err(error.to_owned()); }
                            if launch["zoom"] == true {
                                let created = reply["pane"].as_str().ok_or("Plugin split returned no pane")?;
                                let zoom = this.run_as("pane.zoom", json!({"pane":created}), false, window, cx);
                                if let Some(error) = zoom["error"].as_str() { return Err(error.to_owned()); }
                            }
                        }
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    this.open_overlay(mods::new_overlay_id(), json!({"kind":"toast","notification":{"title":"Legacy action failed","body":error,"level":"error"}}), window, cx);
                }
            });
        }).detach();
        self.answer(Ok(json!({"pending":true})));
    }
}

#[cfg(test)]
mod tests {
    use super::plan_steps;
    use serde_json::json;
    #[test]
    fn rejects_forward_duplicate_and_invalid_split_references() {
        let step = |id, from, direction| json!({"id":id,"from":from,"direction":direction,"argv":["python3"]});
        assert!(plan_steps(&json!({"steps":[step("a","root","right"),step("b","a","down")]})).is_ok());
        for steps in [vec![step("a","b","right")], vec![step("root","root","right")], vec![step("a","root","left")], vec![step("a","root","right"),step("a","root","down")]] {
            assert!(plan_steps(&json!({"steps":steps})).is_err());
        }
    }
}
