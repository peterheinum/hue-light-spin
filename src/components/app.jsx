import React, { useState } from 'react'
import Setup from './setup'

export default () => {
  // Declare a new state variable, which we'll call "count"
  const [count, setCount] = useState(0)
  const baseUrl = '/api'
  const apiCall = () => fetch(`${baseUrl}/`)

  
  return (<Setup />)
}