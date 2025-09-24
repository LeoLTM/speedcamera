import { contextBridge, ipcRenderer } from 'electron';
import { SpeedViolation, CreateSpeedViolation } from '../../../types/database';
import { DATABASE_CHANNELS } from './database-channels';

export interface DatabaseContext {
  addViolation: (violation: CreateSpeedViolation) => Promise<SpeedViolation>;
  getViolations: (limit?: number, offset?: number) => Promise<SpeedViolation[]>;
  getViolationById: (id: number) => Promise<SpeedViolation | undefined>;
  getViolationsByDateRange: (startDate: string, endDate: string) => Promise<SpeedViolation[]>;
  deleteViolation: (id: number) => Promise<boolean>;
  getViolationCount: () => Promise<number>;
}

export const exposeDatabaseContext = (): void => {
  const databaseContext: DatabaseContext = {
    addViolation: (violation: CreateSpeedViolation) => 
      ipcRenderer.invoke(DATABASE_CHANNELS.ADD_VIOLATION, violation),
    
    getViolations: (limit?: number, offset?: number) => 
      ipcRenderer.invoke(DATABASE_CHANNELS.GET_VIOLATIONS, limit, offset),
    
    getViolationById: (id: number) => 
      ipcRenderer.invoke(DATABASE_CHANNELS.GET_VIOLATION_BY_ID, id),
    
    getViolationsByDateRange: (startDate: string, endDate: string) => 
      ipcRenderer.invoke(DATABASE_CHANNELS.GET_VIOLATIONS_BY_DATE_RANGE, startDate, endDate),
    
    deleteViolation: (id: number) => 
      ipcRenderer.invoke(DATABASE_CHANNELS.DELETE_VIOLATION, id),
    
    getViolationCount: () => 
      ipcRenderer.invoke(DATABASE_CHANNELS.GET_VIOLATION_COUNT),
  };

  contextBridge.exposeInMainWorld('database', databaseContext);
};
