import type { SingraMcpPreset } from '../types'

export const DESIGN_MEDIA_PRESETS: SingraMcpPreset[] = [
  {
    id: 'canva',
    name: 'Canva Design & Assets MCP',
    description: 'Canva-Designs, Vorlagen, Brand-Assets und Bild-Exporte direkt anfragen.',
    category: 'design_media',
    transport: 'http',
    endpoint_url: 'https://mcp.canva.com/mcp',
    badge: 'Grafikdesign',
    authType: 'oauth',
    authLabel: 'Canva Konto (OAuth)',
    authHelp:
      'Verbinde dich direkt per OAuth 2.1 mit deinem Canva-Konto.',
    docUrl: 'https://www.canva.com/developers',
    isOptionalAuth: true,
  },
  {
    id: 'figma',
    name: 'Figma Layout & Code Connect MCP',
    description: 'Figma-Komponenten, Canvas-Frames, Design-Tokens und Layouts auslesen.',
    category: 'design_media',
    transport: 'http',
    endpoint_url: 'https://mcp.figma.com/mcp',
    badge: 'UI & UX Design',
    authType: 'oauth',
    authLabel: 'Figma Konto (OAuth)',
    authHelp:
      'Verbinde dich direkt per OAuth 2.1 mit deinem Figma-Konto.',
    docUrl: 'https://www.figma.com/settings',
    isOptionalAuth: true,
  },
  {
    id: 'adobe',
    name: 'Adobe Creative Cloud MCP',
    description: 'Photoshop-, Illustrator- und Firefly-Generierungen sowie Creative Cloud Assets ansteuern.',
    category: 'design_media',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@adobe/mcp-server'],
    auth_header: 'Bearer <ADOBE_IMS_TOKEN>',
    badge: 'Kreativstudio',
    authType: 'token',
    authLabel: 'Adobe Developer IMS Token',
    authPlaceholder: 'Bearer <ADOBE_IMS_TOKEN>',
    authHelp:
      'In der Adobe Developer Console ein Projekt anlegen und Server-to-Server OAuth-Zugangsdaten generieren.',
    docUrl: 'https://developer.adobe.com/console',
    isOptionalAuth: false,
  },
]
