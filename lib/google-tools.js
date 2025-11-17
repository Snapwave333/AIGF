// Google API Tools for Raven AI Assistant
// Handles Calendar, Gmail, and Drive integrations

import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

export class GoogleTools {
  constructor(credentialsPath, tokenPath) {
    this.credentialsPath = credentialsPath;
    this.tokenPath = tokenPath;
    this.auth = null;
    this.calendar = null;
    this.gmail = null;
    this.drive = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return true;

    try {
      if (!fs.existsSync(this.credentialsPath)) {
        console.warn('Google credentials file not found:', this.credentialsPath);
        return false;
      }

      const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
      const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

      this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

      // Load saved token if exists
      if (fs.existsSync(this.tokenPath)) {
        const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
        this.auth.setCredentials(token);

        // Refresh token if expired
        if (this.isTokenExpired(token)) {
          await this.refreshToken();
        }
      } else {
        console.warn('Google token not found. Please run authorization flow first.');
        return false;
      }

      // Initialize service clients
      this.calendar = google.calendar({ version: 'v3', auth: this.auth });
      this.gmail = google.gmail({ version: 'v1', auth: this.auth });
      this.drive = google.drive({ version: 'v3', auth: this.auth });

      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize Google Tools:', error.message);
      return false;
    }
  }

  isTokenExpired(token) {
    if (!token.expiry_date) return false;
    return Date.now() >= token.expiry_date - 60000; // 1 minute buffer
  }

  async refreshToken() {
    try {
      const { credentials } = await this.auth.refreshAccessToken();
      this.auth.setCredentials(credentials);
      fs.writeFileSync(this.tokenPath, JSON.stringify(credentials, null, 2));
      console.log('Token refreshed successfully');
    } catch (error) {
      console.error('Failed to refresh token:', error.message);
      throw error;
    }
  }

  getAuthUrl() {
    if (!this.auth) {
      throw new Error('OAuth2 client not initialized');
    }

    const SCOPES = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive.readonly'
    ];

    return this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES
    });
  }

  async exchangeCodeForToken(code) {
    const { tokens } = await this.auth.getToken(code);
    this.auth.setCredentials(tokens);

    // Ensure directory exists
    const tokenDir = path.dirname(this.tokenPath);
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }

    fs.writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2));
    return tokens;
  }

  // ===== CALENDAR TOOLS =====

  async checkCalendar(options = {}) {
    if (!this.initialized) await this.initialize();
    if (!this.calendar) throw new Error('Calendar service not available');

    const {
      maxResults = 10,
      timeMin = new Date().toISOString(),
      timeMax = null,
      calendarId = 'primary'
    } = options;

    const params = {
      calendarId,
      timeMin,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    };

    if (timeMax) params.timeMax = timeMax;

    const response = await this.calendar.events.list(params);
    const events = response.data.items || [];

    return events.map(event => ({
      id: event.id,
      summary: event.summary || 'Untitled Event',
      description: event.description || '',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      location: event.location || '',
      attendees: (event.attendees || []).map(a => a.email),
      status: event.status
    }));
  }

  async getUpcomingEvents(days = 7) {
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + days);

    return this.checkCalendar({
      timeMax: timeMax.toISOString(),
      maxResults: 25
    });
  }

  // ===== GMAIL TOOLS =====

  async readEmails(options = {}) {
    if (!this.initialized) await this.initialize();
    if (!this.gmail) throw new Error('Gmail service not available');

    const {
      maxResults = 10,
      query = 'is:inbox',
      includeBody = false
    } = options;

    const response = await this.gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query
    });

    const messages = response.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      const fullMessage = await this.gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: includeBody ? 'full' : 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      });

      const headers = fullMessage.data.payload?.headers || [];
      const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

      const email = {
        id: msg.id,
        threadId: msg.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        snippet: fullMessage.data.snippet
      };

      if (includeBody && fullMessage.data.payload) {
        email.body = this.extractEmailBody(fullMessage.data.payload);
      }

      emails.push(email);
    }

    return emails;
  }

  extractEmailBody(payload) {
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
      // Fallback to HTML if no plain text
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
    }

    return '';
  }

  async getUnreadEmails(maxResults = 10) {
    return this.readEmails({
      maxResults,
      query: 'is:unread is:inbox'
    });
  }

  // ===== DRIVE TOOLS =====

  async searchDrive(query, options = {}) {
    if (!this.initialized) await this.initialize();
    if (!this.drive) throw new Error('Drive service not available');

    const {
      maxResults = 20,
      fields = 'files(id, name, mimeType, modifiedTime, size, webViewLink)'
    } = options;

    // Build Drive query from search term
    const driveQuery = query.includes(':')
      ? query // Allow raw queries
      : `name contains '${query}' or fullText contains '${query}'`;

    const response = await this.drive.files.list({
      q: driveQuery,
      pageSize: maxResults,
      fields: `nextPageToken, ${fields}`,
      orderBy: 'modifiedTime desc'
    });

    return (response.data.files || []).map(file => ({
      id: file.id,
      name: file.name,
      type: file.mimeType,
      modified: file.modifiedTime,
      size: file.size,
      link: file.webViewLink
    }));
  }

  async getRecentFiles(maxResults = 10) {
    if (!this.initialized) await this.initialize();
    if (!this.drive) throw new Error('Drive service not available');

    const response = await this.drive.files.list({
      pageSize: maxResults,
      fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink)',
      orderBy: 'modifiedTime desc'
    });

    return (response.data.files || []).map(file => ({
      id: file.id,
      name: file.name,
      type: file.mimeType,
      modified: file.modifiedTime,
      size: file.size,
      link: file.webViewLink
    }));
  }

  // ===== STATUS =====

  getStatus() {
    return {
      initialized: this.initialized,
      hasCredentials: fs.existsSync(this.credentialsPath),
      hasToken: fs.existsSync(this.tokenPath),
      services: {
        calendar: !!this.calendar,
        gmail: !!this.gmail,
        drive: !!this.drive
      }
    };
  }
}

export default GoogleTools;
