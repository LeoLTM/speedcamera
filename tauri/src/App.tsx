import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <div className="flex flex-col h-screen gap-4 p-4 items-center justify-center">
      <h1>Welcome to Tauri + React</h1>

      <form
        className="flex flex-row "
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <Input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <Button type="submit">Greet</Button>
      </form>
      <p>{greetMsg}</p>
    </div>
  );
}

export default App;
