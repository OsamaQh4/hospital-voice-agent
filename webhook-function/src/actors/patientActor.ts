import { StatefulActor } from "@telnyx/edge-runtime";
import type { AppointmentStatus, Department, PatientProfile } from "../types";

const PROFILE_KEY = "profile";

export class PatientActor extends StatefulActor {
  private async loadProfile(): Promise<PatientProfile> {
    const existing = await this.ctx.storage.get<PatientProfile>(PROFILE_KEY);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const fresh: PatientProfile = {
      phoneNumber: this.ctx.id,
      currentAppointment: null,
      callAttemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.ctx.storage.put(PROFILE_KEY, fresh);
    return fresh;
  }

  private async saveProfile(profile: PatientProfile): Promise<PatientProfile> {
    profile.updatedAt = new Date().toISOString();
    await this.ctx.storage.put(PROFILE_KEY, profile);
    return profile;
  }

  async getProfile(): Promise<PatientProfile> {
    return this.loadProfile();
  }

  async recordCallStart(): Promise<PatientProfile> {
    const profile = await this.loadProfile();
    profile.callAttemptCount += 1;
    return this.saveProfile(profile);
  }

  async setFullName(fullName: string): Promise<PatientProfile> {
    const profile = await this.loadProfile();
    profile.fullName = fullName;
    return this.saveProfile(profile);
  }

  async bookAppointment(department: Department, slotTime: string): Promise<PatientProfile> {
    const profile = await this.loadProfile();
    profile.currentAppointment = { department, slotTime, status: "booked" };
    return this.saveProfile(profile);
  }

  async rescheduleAppointment(newSlotTime: string): Promise<PatientProfile> {
    const profile = await this.loadProfile();
    if (profile.currentAppointment === null) {
      throw new Error("No existing appointment to reschedule");
    }
    profile.currentAppointment.slotTime = newSlotTime;
    profile.currentAppointment.status = "booked";
    return this.saveProfile(profile);
  }

  async cancelAppointment(): Promise<PatientProfile> {
    const profile = await this.loadProfile();
    if (profile.currentAppointment) {
      profile.currentAppointment.status = "cancelled";
    }
    return this.saveProfile(profile);
  }

  async updateAppointmentStatus(status: AppointmentStatus): Promise<PatientProfile> {
    const profile = await this.loadProfile();
    if (profile.currentAppointment) {
      profile.currentAppointment.status = status;
    }
    return this.saveProfile(profile);
  }

  async reset(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
