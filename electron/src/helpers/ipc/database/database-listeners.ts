import { ipcMain } from 'electron';
import { getDatabaseService } from '../../../database/database';
import { DATABASE_CHANNELS } from './database-channels';
import { CreateSpeedViolation } from '../../../types/database';

export const addDatabaseListeners = (): void => {
  const dbService = getDatabaseService();

  // Add violation
  ipcMain.handle(DATABASE_CHANNELS.ADD_VIOLATION, async (_, violation: CreateSpeedViolation) => {
    try {
      return dbService.addViolation(violation);
    } catch (error) {
      console.error('Error adding violation:', error);
      throw error;
    }
  });

  // Get violations
  ipcMain.handle(DATABASE_CHANNELS.GET_VIOLATIONS, async (_, limit?: number, offset?: number) => {
    try {
      return dbService.getViolations(limit, offset);
    } catch (error) {
      console.error('Error getting violations:', error);
      throw error;
    }
  });

  // Get violation by ID
  ipcMain.handle(DATABASE_CHANNELS.GET_VIOLATION_BY_ID, async (_, id: number) => {
    try {
      return dbService.getViolationById(id);
    } catch (error) {
      console.error('Error getting violation by ID:', error);
      throw error;
    }
  });

  // Get violations by date range
  ipcMain.handle(DATABASE_CHANNELS.GET_VIOLATIONS_BY_DATE_RANGE, async (_, startDate: string, endDate: string) => {
    try {
      return dbService.getViolationsByDateRange(startDate, endDate);
    } catch (error) {
      console.error('Error getting violations by date range:', error);
      throw error;
    }
  });

  // Delete violation
  ipcMain.handle(DATABASE_CHANNELS.DELETE_VIOLATION, async (_, id: number) => {
    try {
      return dbService.deleteViolation(id);
    } catch (error) {
      console.error('Error deleting violation:', error);
      throw error;
    }
  });

  // Get violation count
  ipcMain.handle(DATABASE_CHANNELS.GET_VIOLATION_COUNT, async () => {
    try {
      return dbService.getViolationCount();
    } catch (error) {
      console.error('Error getting violation count:', error);
      throw error;
    }
  });
};
