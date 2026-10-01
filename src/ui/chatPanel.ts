// Chat-Panel für die Kommunikation mit dem AI-Provider

import { LMStudioProvider } from '../core/aiProvider';

export class ChatPanel {
  private provider: LMStudioProvider;

  constructor(provider: LMStudioProvider) {
    this.provider = provider;
  }

  async sendMessage(prompt: string): Promise<void> {
    try {
      const response = await this.provider.sendMessage(prompt);
      console.log('AI Response:', response);
      // Hier könnte die UI-Integration erfolgen, z. B. Nachricht in Chat einfügen
    } catch (error) {
      console.error('Failed to get AI response:', error);
      // Fehlerbehandlung und Benachrichtigung der Nutzerin
    }
  }

  render(): void {
    console.log('Rendering chat panel with LM Studio integration.');
  }
}

// Beispiel-Instanz
const aiProvider = new LMStudioProvider({
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'mistralai/Mistral-7B-Instruct-v0.2',
});
const chatPanel = new ChatPanel(aiProvider);
chatPanel.render();
