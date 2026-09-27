import { StatefulActor } from "@telnyx/edge-runtime";
import type { AppointmentStatus, Department, PatientProfile } from "../types";

const PROFILE_KEY = "profile";

export class PatientActorV2 extends StatefulActor {
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
    const VALID_DEPARTMENTS: Department[] = ["general_medicine", "pediatrics", "dental"];
    if (!VALID_DEPARTMENTS.includes(department)) {
      throw new Error(`Invalid department: ${department}`);
    }
    if (Number.isNaN(new Date(slotTime).getTime())) {
      throw new Error(`Invalid slotTime: ${slotTime}`);
    }
    const profile = await this.loadProfile();
    profile.currentAppointment = { department, slotTime, status: "booked" };
    return this.saveProfile(profile);
  }

  async rescheduleAppointment(newSlotTime: string): Promise<PatientProfile> {
    if (Number.isNaN(new Date(newSlotTime).getTime())) {
      throw new Error(`Invalid slotTime: ${newSlotTime}`);
    }
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

  /**
   * Update the status of the current appointment.
   * Not currently exposed via any MCP tool, but kept for potential
   * future use (e.g. marking an appointment "completed" after the
   * patient is seen, or "cancelled" via an external admin flow).
   */
  async updateAppointmentStatus(status: AppointmentStatus): Promise<PatientProfile> {
    const VALID_STATUSES: AppointmentStatus[] = ["none", "booked", "completed", "cancelled"];
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
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
