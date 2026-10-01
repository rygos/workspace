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
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Error sending message to LM Studio:', error);
      throw error;
    }
  }
}
