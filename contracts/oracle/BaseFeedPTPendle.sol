// SPDX-License-Identifier: GPL-3.0

/*
                  *                                                  █                              
                *****                                               ▓▓▓                             
                  *                                               ▓▓▓▓▓▓▓                         
                                   *            ///.           ▓▓▓▓▓▓▓▓▓▓▓▓▓                       
                                 *****        ////////            ▓▓▓▓▓▓▓                          
                                   *       /////////////            ▓▓▓                             
                     ▓▓                  //////////////////          █         ▓▓                   
                   ▓▓  ▓▓             ///////////////////////                ▓▓   ▓▓                
                ▓▓       ▓▓        ////////////////////////////           ▓▓        ▓▓              
              ▓▓            ▓▓    /////////▓▓▓///////▓▓▓/////////       ▓▓             ▓▓            
           ▓▓                 ,////////////////////////////////////// ▓▓                 ▓▓         
        ▓▓                  //////////////////////////////////////////                     ▓▓      
      ▓▓                  //////////////////////▓▓▓▓/////////////////////                          
                       ,////////////////////////////////////////////////////                        
                    .//////////////////////////////////////////////////////////                     
                     .//////////////////////////██.,//////////////////////////█                     
                       .//////////////////////████..,./////////////////////██                       
                        ...////////////////███████.....,.////////////////███                        
                          ,.,////////////████████ ........,///////////████                          
                            .,.,//////█████████      ,.......///////████                            
                               ,..//████████           ........./████                               
                                 ..,██████                .....,███                                 
                                    .██                     ,.,█                                    
                                                                                                    
                                                                                                    
                                                                                                    
               ▓▓            ▓▓▓▓▓▓▓▓▓▓       ▓▓▓▓▓▓▓▓▓▓        ▓▓               ▓▓▓▓▓▓▓▓▓▓          
             ▓▓▓▓▓▓          ▓▓▓    ▓▓▓       ▓▓▓               ▓▓               ▓▓   ▓▓▓▓         
           ▓▓▓    ▓▓▓        ▓▓▓    ▓▓▓       ▓▓▓    ▓▓▓        ▓▓               ▓▓▓▓▓             
          ▓▓▓        ▓▓      ▓▓▓    ▓▓▓       ▓▓▓▓▓▓▓▓▓▓        ▓▓▓▓▓▓▓▓▓▓       ▓▓▓▓▓▓▓▓▓▓          
*/

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "contracts/utils/AccessControlManager.sol";
import "./BaseOraclePTPendle.sol";

/// @title BaseFeedPtPendle
/// @author Angle Labs, Inc.
/// @notice Base Contract to implement the AggregatorV3Interface for Pendle PT tokens
abstract contract BaseFeedPTPendle is AccessControl, AggregatorV3Interface, BaseOraclePTPendle {
    // =================================== Errors ===================================

    /// @notice Constructor for an oracle following AggregatorV3Interface
    /// @param accessControlManager Contract managing authorization
    constructor(
        IAccessControlManager accessControlManager,
        uint256 _maxImpliedRate,
        uint32 _twapDuration
    ) AccessControl(accessControlManager) BaseOraclePTPendle(_maxImpliedRate, _twapDuration) {}

    function _onlyGovernorOrGuardian() internal view override {
        if (!accessControlManager.isGovernorOrGuardian(msg.sender)) revert NotGovernorOrGuardian();
    }

    /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                 AGGREGATORV3INTERFACE                                              
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

    /// @inheritdoc AggregatorV3Interface
    function decimals() external view returns (uint8) {
        return 18;
    }

    /// @inheritdoc AggregatorV3Interface
    function version() external view returns (uint256) {
        return 1;
    }

    /// @inheritdoc AggregatorV3Interface
    function getRoundData(
        uint80 _roundId
    )
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (0, int256(_getQuoteAmount()), 0, 0, 0);
    }

    /// @inheritdoc AggregatorV3Interface
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (0, int256(_getQuoteAmount()), 0, 0, 0);
    }
}
