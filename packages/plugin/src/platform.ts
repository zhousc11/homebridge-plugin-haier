import { HaierApi, PLATFORM_NAME, PLUGIN_NAME } from '@hb-haier/shared';

import { AirConditionerAccessory } from './accessories';

import type { HaierPlatformAccessory, HaierPlatformAccessoryContext } from './types';
import type { DeviceInfo, HaierApiConfig } from '@hb-haier/shared';
import type { API, Characteristic, DynamicPlatformPlugin, Logger, PlatformConfig, Service } from 'homebridge';

export class HaierHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;

  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: HaierPlatformAccessory[] = [];

  public haierApi!: HaierApi;

  private discoveryInterval?: NodeJS.Timeout;

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('平台初始化完成', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.haierApi = new HaierApi(config as unknown as HaierApiConfig, api);
      // this.haierApi.connectWss();
      this.discoverDevices();
      this.discoveryInterval = setInterval(() => this.discoverDevices(), 2 * 60 * 1000);
    });

    this.api.on('shutdown', () => {
      this.log.debug('Executed shutdown callback');
      this.discoveryInterval && clearInterval(this.discoveryInterval);
    });
  }

  configureAccessory(accessory: HaierPlatformAccessory) {
    this.log.info('从缓存加载附件：', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const { familyId } = this.config;

    if (!familyId) {
      this.log.error('请在 config.json 中配置 familyId');
      return;
    }

    this.haierApi.getDevicesByFamilyId(familyId).then(devices => {
      devices.forEach(device => this.handleDevice(device));
    });
  }

  private handleDevice(device: DeviceInfo) {
    if (this.isDeviceIneligible(device)) {
      return;
    }

    const AccessoryClass = this.getAccessoryClass(device);
    if (!AccessoryClass) {
      this.log.warn(
        '设备',
        device.baseInfo.deviceName,
        '暂不支持，可提交 issue 申请支持',
        require('../package.json').bugs.url,
      );
      return;
    }
    const uuid = this.api.hap.uuid.generate(device.baseInfo.deviceId);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      existingAccessory.context = {
        deviceInfo: device,
      };
      this.api.updatePlatformAccessories([existingAccessory]);
      new AccessoryClass(this, existingAccessory);
    } else {
      this.log.info('Adding new accessory:', device.baseInfo.deviceName);
      const accessory = new this.api.platformAccessory<HaierPlatformAccessoryContext>(device.baseInfo.deviceName, uuid);
      accessory.context = {
        deviceInfo: device,
      };
      new AccessoryClass(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  private isDeviceIneligible(device: DeviceInfo): boolean {
    if (!device.baseInfo.permission.auth.control) {
      this.log.warn('设备', device.baseInfo.deviceName, '没有控制权限');
      return true;
    }
    if (!device.extendedInfo.bindType) {
      this.log.warn('设备', device.baseInfo.deviceName, '不支持云端控制');
      return true;
    }
    return false;
  }

  private getAccessoryClass(deviceInfo: DeviceInfo) {
    switch (deviceInfo.extendedInfo.categoryGrouping) {
      case '空调':
        return AirConditionerAccessory;

      default:
        return undefined;
    }
  }
}
