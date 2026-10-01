// AI-Provider für die Verbindung zu LM Studio

export class LMStudioProvider {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;

  constructor(config: { baseUrl: string; model: string; apiKey?: string }) {
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:1234/v1';
    this.model = config.model || 'mistralai/Mistral-7B-Instruct-v0.2';
    this.apiKey = config.apiKey;
  }

  async sendMessage(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 150,
        }),
      });

      if (!response.ok) {
        // Bei Fehlern den Chat-Panel in einen Fehlerzustand versetzen
        console.warn(`LM Studio API request failed with status ${response.status}. Falling back to offline mode.`);
        
        // Beispiel für eine Offline-Nachricht
        return "Ich kann derzeit keine Verbindung zum LM Studio herstellen. Bitte überprüfen Sie Ihre Netzwerkverbindung oder starten Sie den LM Studio-Server.";
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Error sending message to LM Studio:', error);
      
      // Bei Fehlern den Chat-Panel in einen Fehlerzustand versetzen
      return "Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.";
    }
  }
}
