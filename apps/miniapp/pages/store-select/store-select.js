// pages/store-select/store-select.js
const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 44,
    userLocation: null,
    selectedStore: null,
    stores: [],
    loading: true,
    error: null
  },

  onLoad(options) {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 44
    })

    // 如果从材料包创建页面传来了数据，保存到临时存储
    if (options.from === 'package-create') {
      const packageData = wx.getStorageSync('temp_package_data')
      if (packageData) {
        console.log('接收到材料包数据:', packageData)
      }
    }

    // 加载真实服务点数据
    this._loadStores()
  },

  // 加载服务点列表
  _loadStores() {
    this.setData({ loading: true, error: null })
    
    api.getPublicTerminals()
      .then(list => {
        console.log('获取到服务点列表:', list)
        
        // 转换数据格式
        const stores = list.map(terminal => ({
          id: terminal.id,
          name: terminal.displayName || '服务点',
          address: terminal.locationLabel || '地址待补充',
          distance: '计算中...',
          distanceValue: 999999, // 默认排最后
          hours: '营业时间待补充',
          status: terminal.isOnline ? 'open' : 'closed',
          phone: '010-00000000', // 待后端补充
          facilities: ['打印', '扫描', '复印'] // 默认设施
        }))
        
        this.setData({ 
          stores,
          loading: false 
        })
        
        // 获取用户位置并计算距离
        this._getUserLocation()
      })
      .catch(err => {
        console.error('加载服务点失败:', err)
        this.setData({ 
          loading: false,
          error: err.message || '加载失败，请稍后重试'
        })
      })
  },

  // 获取用户位置
  _getUserLocation() {
    // 实际使用时调用微信定位API
    // wx.getLocation({
    //   type: 'gcj02',
    //   success: (res) => {
    //     this.setData({
    //       userLocation: {
    //         latitude: res.latitude,
    //         longitude: res.longitude
    //       }
    //     })
    //     this._calculateDistances()
    //   }
    // })
    
    // Mock：使用默认位置（北京大学附近）
    this.setData({
      userLocation: {
        latitude: 39.9925,
        longitude: 116.3067
      }
    })
  },

  // 计算距离（实际使用时调用地图API）
  _calculateDistances() {
    // 实际使用时调用腾讯地图或高德地图API计算真实距离
    // 这里使用Mock数据
    const stores = this.data.stores.sort((a, b) => a.distanceValue - b.distanceValue)
    this.setData({ stores })
  },

  // 选择服务点
  selectStore(e) {
    const { id } = e.currentTarget.dataset
    const store = this.data.stores.find(s => s.id === id)
    
    this.setData({ selectedStore: id })
    
    // 保存选择的服务点到临时存储
    wx.setStorageSync('temp_selected_store', store)
    
    wx.showToast({
      title: '已选择服务点',
      icon: 'success',
      duration: 1500
    })
  },

  // 查看服务点详情
  viewStoreDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.showToast({
      title: `查看服务点 ${id} 详情`,
      icon: 'none'
    })
    // 实际使用时跳转到服务点详情页或弹出详情弹窗
  },

  // 拨打电话
  callStore(e) {
    const { phone } = e.currentTarget.dataset
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => {
        wx.showToast({
          title: '拨打失败',
          icon: 'none'
        })
      }
    })
  },

  // 在地图中查看
  viewInMap(e) {
    const { id } = e.currentTarget.dataset
    const store = this.data.stores.find(s => s.id === id)
    
    if (store) {
      wx.openLocation({
        latitude: store.lat,
        longitude: store.lng,
        name: store.name,
        address: store.address,
        scale: 15
      })
    }
  },

  // 确认并继续
  confirmAndContinue() {
    const { selectedStore, stores } = this.data
    
    if (!selectedStore) {
      wx.showToast({
        title: '请先选择服务点',
        icon: 'none'
      })
      return
    }
    
    const store = stores.find(s => s.id === selectedStore)
    
    // 跳转到订单确认页面
    wx.navigateTo({
      url: '/pages/package-confirm/package-confirm',
      success: () => {
        // 传递数据通过storage（实际项目中可使用全局状态管理）
        wx.setStorageSync('temp_selected_store', store)
      }
    })
  },

  // 返回上一页
  goBack() {
    wx.navigateBack()
  }
})
